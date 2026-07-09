"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import type { KeyboardEvent } from "react";
import { Settings, Send, Sparkles, AlertTriangle, FileText, Wand2, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  serializeProject,
  CHAT_SYSTEM_PROMPT,
  ANALYSIS_SYSTEM_PROMPT,
} from "@/lib/ai-prompts";
import { parseMsProjectXml, type GanttProject } from "@/lib/ms-project-parser";
import { AiConfigDialog } from "./ai-config-dialog";

/* eslint-disable @typescript-eslint/no-explicit-any */

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface AiPanelProps {
  project: GanttProject | null;
  onLoadProject: (p: GanttProject, name: string) => void;
}

export function AiPanel({ project, onLoadProject }: AiPanelProps) {
  const [aiAvailable] = useState(
    () => typeof window !== "undefined" && !!(window as any).ai,
  );
  const [mode, setMode] = useState<"chat" | "generate">("chat");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [genInput, setGenInput] = useState("");
  const [genPreview, setGenPreview] = useState("");
  const [loading, setLoading] = useState(false);
  const [configOpen, setConfigOpen] = useState(false);

  const requestIdRef = useRef<string | null>(null);
  const isGenerateRef = useRef(false);
  const genBufferRef = useRef("");
  const chatBufferRef = useRef(""); // accumulates chat response for XML detection
  const chunkSeenRef = useRef(false);
  const replaceOnFirstRef = useRef(false);
  const registeredRef = useRef(false);

  const scrollRef = useRef<HTMLDivElement>(null);

  // Register streaming listeners once (guard against StrictMode double-invoke)
  useEffect(() => {
    if (registeredRef.current) return;
    const ai = (window as any).ai;
    if (!ai) return;
    registeredRef.current = true;

    ai.onStreamChunk((data: { requestId: string; chunk: string }) => {
      if (data.requestId !== requestIdRef.current) return;
      if (isGenerateRef.current) {
        genBufferRef.current += data.chunk;
        setGenPreview((prev) => prev + data.chunk);
      } else {
        chatBufferRef.current += data.chunk;
        setMessages((prev) => {
          const idx = prev.length - 1;
          if (idx < 0 || prev[idx].role !== "assistant") return prev;
          const next = [...prev];
          if (replaceOnFirstRef.current && !chunkSeenRef.current) {
            next[idx] = { role: "assistant", content: data.chunk };
          } else {
            next[idx] = {
              role: "assistant",
              content: next[idx].content + data.chunk,
            };
          }
          return next;
        });
        chunkSeenRef.current = true;
      }
    });

    ai.onStreamEnd((data: { requestId: string }) => {
      if (data.requestId !== requestIdRef.current) return;
      if (isGenerateRef.current) {
        const full = genBufferRef.current;
        const match = full.match(/<Project>[\s\S]*<\/Project>/);
        const xmlStr = match ? match[0] : full.trim();
        try {
          const p = parseMsProjectXml(xmlStr);
          onLoadProject(p, "ai-generated.xml");
          toast.success("Проект сгенерирован и загружен");
          setMode("chat");
        } catch {
          toast.error("Не удалось распарсить XML", {
            description: "Проверьте описание или модель",
          });
        }
        genBufferRef.current = "";
        setGenPreview("");
        isGenerateRef.current = false;
      } else {
        // Chat mode — auto-detect <Project> XML and apply instantly
        const chatFull = chatBufferRef.current;
        const xmlMatch = chatFull.match(/<Project>[\s\S]*<\/Project>/);
        if (xmlMatch) {
          try {
            const p = parseMsProjectXml(xmlMatch[0]);
            onLoadProject(p, "ai-updated.xml");
            toast.success("План обновлён", {
              description: `${p.tasks.length} задач · изменения применены автоматически`,
            });
          } catch {
            // XML present but malformed — show "Apply" button on message
          }
        }
        chatBufferRef.current = "";
      }
      setLoading(false);
      chunkSeenRef.current = false;
      replaceOnFirstRef.current = false;
      requestIdRef.current = null;
    });

    ai.onStreamError((data: { requestId: string; error: string }) => {
      if (data.requestId !== requestIdRef.current) return;
      setLoading(false);
      chunkSeenRef.current = false;
      replaceOnFirstRef.current = false;
      isGenerateRef.current = false;
      requestIdRef.current = null;
      toast.error("Ошибка AI", { description: data.error });
    });
  }, [onLoadProject]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const sendMessage = useCallback(() => {
    const ai = (window as any).ai;
    const text = input.trim();
    if (!text || loading || !ai) return;

    const userMsg: ChatMessage = { role: "user", content: text };
    const history = [...messages, userMsg];
    setMessages([...history, { role: "assistant", content: "" }]);
    setInput("");

    const reqId = crypto.randomUUID();
    requestIdRef.current = reqId;
    isGenerateRef.current = false;
    chunkSeenRef.current = false;
    replaceOnFirstRef.current = false;
    setLoading(true);

    ai.chat(
      history.map((m) => ({ role: m.role, content: m.content })),
      CHAT_SYSTEM_PROMPT,
      reqId,
    );
  }, [input, loading, messages]);

  const handleAnalyze = useCallback(() => {
    const ai = (window as any).ai;
    if (!project || loading || !ai) return;

    const reqId = crypto.randomUUID();
    requestIdRef.current = reqId;
    isGenerateRef.current = false;
    chunkSeenRef.current = false;
    replaceOnFirstRef.current = true;

    setMessages((prev) => [
      ...prev,
      { role: "user", content: "Проанализируй проект на риски" },
      { role: "assistant", content: "Анализирую проект..." },
    ]);
    setLoading(true);

    ai.chat(
      [
        {
          role: "user",
          content: `Проанализируй этот проект на риски:\n\n${serializeProject(project)}`,
        },
      ],
      ANALYSIS_SYSTEM_PROMPT,
      reqId,
    );
  }, [project, loading]);

  const handleGenerate = useCallback(() => {
    const ai = (window as any).ai;
    if (!genInput.trim() || loading || !ai) return;

    const reqId = crypto.randomUUID();
    requestIdRef.current = reqId;
    isGenerateRef.current = true;
    genBufferRef.current = "";
    chunkSeenRef.current = false;
    setLoading(true);
    setGenPreview("");

    ai.generate(genInput.trim(), reqId);
  }, [genInput, loading]);

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-200px)] bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
      {/* Header */}
      <div className="bg-slate-800 text-white px-4 py-2.5 flex items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-emerald-400" />
          <span className="text-sm font-semibold">AI-ассистент</span>
        </div>
        <button
          onClick={() => setConfigOpen(true)}
          className="text-slate-300 hover:text-white transition-colors p-1 rounded-md hover:bg-white/10"
          title="Настройки AI"
        >
          <Settings className="w-4 h-4" />
        </button>
      </div>

      {/* Mode toggle + quick actions */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-100 bg-slate-50 shrink-0">
        <div className="flex items-center gap-0.5 bg-slate-200/70 rounded-lg p-0.5">
          <ModeBtn
            active={mode === "chat"}
            onClick={() => setMode("chat")}
            icon={<Sparkles className="w-3.5 h-3.5" />}
            label="Чат"
          />
          <ModeBtn
            active={mode === "generate"}
            onClick={() => setMode("generate")}
            icon={<Wand2 className="w-3.5 h-3.5" />}
            label="Генерация"
          />
        </div>
        {mode === "chat" && project && (
          <Button
            variant="outline"
            size="sm"
            onClick={handleAnalyze}
            disabled={loading}
            className="ml-auto h-7 text-[12px]"
          >
            <AlertTriangle className="w-3.5 h-3.5" />
            Анализировать риски
          </Button>
        )}
      </div>

      {/* Warning if no AI */}
      {!aiAvailable && (
        <div className="flex items-start gap-2 px-4 py-3 bg-amber-50 border-b border-amber-200 text-amber-800 text-[12px] shrink-0">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <div>
            AI недоступен. Запустите приложение в Electron и настройте провайдера.
          </div>
        </div>
      )}

      {/* Body */}
      {mode === "chat" ? (
        <>
          <div
            ref={scrollRef}
            className="flex-1 overflow-y-auto px-4 py-3 space-y-3"
          >
            {messages.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center text-slate-400 gap-2 px-6">
                <Sparkles className="w-8 h-8 text-slate-300" />
                <p className="text-sm">
                  {project
                    ? "Задайте вопрос о проекте или нажмите «Анализировать риски»."
                    : "Опишите проект, который хотите создать, в режиме «Генерация»."}
                </p>
              </div>
            ) : (
              messages.map((m, i) => (
                <div
                  key={i}
                  className={cn(
                    "flex",
                    m.role === "user" ? "justify-end" : "justify-start",
                  )}
                >
                  <div
                    className={cn(
                      "max-w-[85%] rounded-2xl px-3.5 py-2 text-[13px] leading-relaxed whitespace-pre-wrap break-words",
                      m.role === "user"
                        ? "bg-emerald-600 text-white rounded-br-md"
                        : "bg-white border border-slate-200 text-slate-700 rounded-bl-md",
                    )}
                  >
                    {m.content || (
                      <span className="inline-flex gap-1 items-center py-1">
                        <Dot /> <Dot delay="0.15s" /> <Dot delay="0.3s" />
                      </span>
                    )}
                    {/* Show "Apply XML" button if assistant message contains <Project> */}
                    {m.role === "assistant" && m.content && /<Project>[\s\S]*<\/Project>/.test(m.content) && (
                      <button
                        onClick={() => {
                          const match = m.content.match(/<Project>[\s\S]*<\/Project>/);
                          if (!match) return;
                          try {
                            const p = parseMsProjectXml(match[0]);
                            onLoadProject(p, "ai-updated.xml");
                            toast.success("План обновлён", { description: `${p.tasks.length} задач` });
                          } catch {
                            toast.error("Не удалось применить XML");
                          }
                        }}
                        className="mt-2 flex items-center gap-1.5 px-2.5 py-1 bg-emerald-600 text-white rounded-md text-[11px] font-medium hover:bg-emerald-700 transition-colors"
                      >
                        <Check className="w-3 h-3" />
                        Применить изменения
                      </button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Input */}
          <div className="border-t border-slate-200 p-3 flex items-end gap-2 shrink-0">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Спросите о проекте…"
              rows={1}
              className="resize-none min-h-[40px] max-h-32 text-[13px]"
              disabled={!aiAvailable}
            />
            <Button
              size="icon"
              onClick={sendMessage}
              disabled={!input.trim() || loading || !aiAvailable}
              className="h-9 w-9 shrink-0"
            >
              <Send className="w-4 h-4" />
            </Button>
          </div>
        </>
      ) : (
        /* Generate mode */
        <div className="flex-1 flex flex-col p-4 gap-3 overflow-y-auto">
          <div className="text-[13px] text-slate-500">
            Опишите проект, и AI сгенерирует MS Project XML.
          </div>
          <Textarea
            value={genInput}
            onChange={(e) => setGenInput(e.target.value)}
            placeholder={
              "Напр.: Ремонт офиса 200 кв.м за 2 месяца: демонтаж, черновые работы, электрика, чистовая отделка. 3 бригады, 2 вехи…"
            }
            rows={5}
            className="text-[13px]"
            disabled={!aiAvailable || loading}
          />
          <Button
            onClick={handleGenerate}
            disabled={!genInput.trim() || loading || !aiAvailable}
            className="w-fit"
          >
            <Wand2 className="w-4 h-4" />
            {loading ? "Генерация…" : "Сгенерировать"}
          </Button>
          {genPreview && (
            <div className="mt-2">
              <div className="text-[11px] text-slate-400 mb-1 flex items-center gap-1">
                <FileText className="w-3 h-3" />
                Предпросмотр XML
              </div>
              <pre className="text-[10px] font-mono text-slate-600 bg-slate-50 border border-slate-200 rounded-lg p-3 max-h-64 overflow-auto whitespace-pre-wrap break-all">
                {genPreview}
              </pre>
            </div>
          )}
        </div>
      )}

      <AiConfigDialog open={configOpen} onClose={() => setConfigOpen(false)} />
    </div>
  );
}

function ModeBtn({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[12px] font-medium transition-colors",
        active
          ? "bg-white text-slate-900 shadow-sm"
          : "text-slate-500 hover:text-slate-700",
      )}
    >
      {icon}
      {label}
    </button>
  );
}

function Dot({ delay = "0s" }: { delay?: string }) {
  return (
    <span
      className="inline-block w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce"
      style={{ animationDelay: delay }}
    />
  );
}
