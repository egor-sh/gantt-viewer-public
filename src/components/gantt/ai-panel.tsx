"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import type { KeyboardEvent } from "react";
import { Settings, Send, Sparkles, AlertTriangle, FileText, Wand2, Check, Trash2, ChevronRight, ChevronDown } from "lucide-react";
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
  reasoning?: string;
  ts?: number;
}

interface AiPanelProps {
  project: GanttProject | null;
  onLoadProject: (p: GanttProject, name: string) => void;
}

const STORAGE_KEY = "gv_chat_history";
const MAX_STORED = 50;

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
  const chatBufferRef = useRef("");
  const chunkSeenRef = useRef(false);
  const replaceOnFirstRef = useRef(false);
  const registeredRef = useRef(false);
  const projectRef = useRef<GanttProject | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // ── Sync project ref ──
  useEffect(() => {
    projectRef.current = project;
  }, [project]);

  // ── Load chat history from localStorage on mount ──
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as ChatMessage[];
        if (Array.isArray(parsed) && parsed.length > 0) {
          setMessages(parsed);
        }
      }
    } catch {
      // ignore corrupted storage
    }
  }, []);

// ── Save chat draft to localStorage so it survives tab switches ──
  useEffect(() => {
    try {
      localStorage.setItem("gv_chat_draft", input);
    } catch {}
  }, [input]);

  useEffect(() => {
    try {
      const d = localStorage.getItem("gv_chat_draft");
      if (d) setInput(d);
    } catch {}
  }, []);

  // ── Save chat history to localStorage when messages change ──
  useEffect(() => {
    try {
      const trimmed = messages.slice(-MAX_STORED);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
    } catch {
      // storage might be full; ignore
    }
  }, [messages]);

  // ── Auto-resize input textarea ──
  const autoResize = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, []);

  useEffect(() => {
    autoResize();
  }, [input, autoResize]);

  // Register streaming listeners once
  useEffect(() => {
    if (registeredRef.current) return;
    const ai = (window as any).ai;
    if (!ai) return;
    registeredRef.current = true;

    ai.onStreamReasoning?.((data: { requestId: string; chunk: string }) => {
      if (data.requestId !== requestIdRef.current) return;
      setMessages((prev) => {
        const next = [...prev];
        const idx = next.length - 1;
        if (idx < 0 || next[idx].role !== "assistant") return prev;
        next[idx] = { ...next[idx], reasoning: (next[idx].reasoning || "") + data.chunk };
        return next;
      });
    });
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
        const match = full.match(/<Project[^>]*>[\s\S]*?<\/Project\s*>/);
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
        // Chat mode — auto-detect <Project> XML and apply
        const chatFull = chatBufferRef.current;
        const xmlMatch = chatFull.match(/<Project[^>]*>[\s\S]*?<\/Project\s*>/);
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

  // Auto-scroll
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages]);

  // ── Build messages array with project context injected ──
  const buildContextMessages = useCallback(
    (history: ChatMessage[]): { role: string; content: string }[] => {
      const proj = projectRef.current;
      const ctx: { role: string; content: string }[] = [];

      if (proj) {
        ctx.push({
          role: "user",
          content: `[КОНТЕКСТ — текущий проект]\n${serializeProject(proj)}\n[КОНЕЦ КОНТЕКСТА]\n\nИспользуй эти данные проекта для ответов. Пользователь может задавать вопросы о задачах, сроках, ресурсах. Когда пользователь просит что-то изменить — верни ОБНОВЛЁННЫЙ XML.`,
        });
        ctx.push({
          role: "assistant",
          content: "Понял, проект загружен. Готов отвечать на вопросы и вносить изменения.",
        });
      }

      return [...ctx, ...history.map((m) => ({ role: m.role, content: m.content }))];
    },
    [],
  );

  const handleStop = useCallback(() => {
    const ai = (window as any).ai;
    const rid = requestIdRef.current;
    if (ai?.stop && rid) ai.stop(rid);
    setLoading(false);
  }, []);

  const sendMessage = useCallback(() => {
    const ai = (window as any).ai;
    const text = input.trim();
    if (!text || loading || !ai) return;

    const userMsg: ChatMessage = { role: "user", content: text, ts: Date.now() };

    const history = [...messages, userMsg];
    setMessages([...history, { role: "assistant", content: "", ts: Date.now() }]);
    setInput("");

    const reqId = crypto.randomUUID();
    requestIdRef.current = reqId;
    isGenerateRef.current = false;
    chunkSeenRef.current = false;
    replaceOnFirstRef.current = false;
    setLoading(true);

    // Inject project context as system-level preamble
    const contextMessages = buildContextMessages(history);

    ai.chat(contextMessages, CHAT_SYSTEM_PROMPT, reqId);
  }, [input, loading, messages, buildContextMessages]);

  const handleAnalyze = useCallback(() => {
    const ai = (window as any).ai;
    const proj = projectRef.current;
    if (!proj || loading || !ai) return;

    const reqId = crypto.randomUUID();
    requestIdRef.current = reqId;
    isGenerateRef.current = false;
    chunkSeenRef.current = false;
    replaceOnFirstRef.current = true;

    setMessages((prev) => [
      ...prev,
      { role: "user", content: "Проанализируй проект на риски", ts: Date.now() },
      { role: "assistant", content: "Анализирую проект...", ts: Date.now() },
    ]);
    setLoading(true);

    ai.chat(
      [
        {
          role: "user",
          content: `Проанализируй этот проект на риски:\n\n${serializeProject(proj)}`,
        },
      ],
      ANALYSIS_SYSTEM_PROMPT,
      reqId,
    );
  }, [loading]);

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

  const handleClearHistory = useCallback(() => {
    setMessages([]);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
    toast("История чата очищена");
  }, []);

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-200px)] bg-white rounded-xl border border-alfa-gray-light shadow-sm overflow-hidden">
      {/* Header — dark charcoal, red accent */}
      <div className="bg-alfa-charcoal text-white px-4 py-2.5 flex items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-alfa-red" />
          <span className="text-sm font-semibold">AI-ассистент</span>
          {project && (
            <span className="text-[10px] text-alfa-gray bg-alfa-slate px-2 py-0.5 rounded-full">
              {project.tasks.length} задач в контексте
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {messages.length > 0 && (
            <button
              onClick={handleClearHistory}
              className="text-alfa-gray hover:text-white transition-colors p-1 rounded-md hover:bg-white/10"
              title="Очистить историю"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            onClick={() => setConfigOpen(true)}
            className="text-alfa-gray hover:text-white transition-colors p-1 rounded-md hover:bg-white/10"
            title="Настройки AI"
          >
            <Settings className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Mode toggle + quick actions */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-alfa-gray-light bg-alfa-gray-bg shrink-0">
        <div className="flex items-center gap-0.5 bg-alfa-gray-light rounded-lg p-0.5">
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
            className="ml-auto h-7 text-[12px] border-alfa-gray-light text-alfa-charcoal hover:bg-alfa-gray-light"
          >
            <AlertTriangle className="w-3.5 h-3.5" />
            Анализировать риски
          </Button>
        )}
      </div>

      {/* Warning if no AI */}
      {!aiAvailable && (
        <div className="flex items-start gap-2 px-4 py-3 bg-alfa-red/5 border-b border-alfa-red/20 text-alfa-red-dark text-[12px] shrink-0">
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
              <div className="h-full flex flex-col items-center justify-center text-center text-alfa-gray gap-2 px-6">
                <Sparkles className="w-8 h-8 text-alfa-gray-light" />
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
                  <MessageBubble key={i} m={m} onLoadProject={onLoadProject} loading={loading} />
                </div>
              ))
            )}
          </div>

          {/* Input — auto-resize textarea */}
          <div className="border-t border-alfa-gray-light p-3 flex items-end gap-2 shrink-0 bg-white">
            <Textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Спросите о проекте… (Enter — отправить, Shift+Enter — новая строка)"
              rows={1}
              className="resize-none min-h-[40px] max-h-40 text-[13px] border-alfa-gray-light focus-visible:ring-alfa-red"
              disabled={!aiAvailable}
            />
            <Button
              size="icon"
              onClick={loading ? handleStop : sendMessage}
              disabled={!input.trim() || loading || !aiAvailable}
              className="h-9 w-9 shrink-0 bg-alfa-red hover:bg-alfa-red-dark text-white"
            >
              <Send className="w-4 h-4" />
            </Button>
          </div>
        </>
      ) : (
        /* Generate mode */
        <div className="flex-1 flex flex-col p-4 gap-3 overflow-y-auto">
          <div className="text-[13px] text-alfa-gray">
            Опишите проект, и AI сгенерирует MS Project XML.
          </div>
          <Textarea
            value={genInput}
            onChange={(e) => setGenInput(e.target.value)}
            placeholder={
              "Напр.: Ремонт офиса 200 кв.м за 2 месяца: демонтаж, черновые работы, электрика, чистовая отделка. 3 бригады, 2 вехи…"
            }
            rows={5}
            className="text-[13px] border-alfa-gray-light focus-visible:ring-alfa-red"
            disabled={!aiAvailable || loading}
          />
          <Button
            onClick={loading ? handleStop : handleGenerate}
            disabled={!genInput.trim() || loading || !aiAvailable}
            className="w-fit bg-alfa-red hover:bg-alfa-red-dark text-white"
          >
            <Wand2 className="w-4 h-4" />
            {loading ? "Генерация…" : "Сгенерировать"}
          </Button>
          {genPreview && (
            <div className="mt-2">
              <div className="text-[11px] text-alfa-gray mb-1 flex items-center gap-1">
                <FileText className="w-3 h-3" />
                Предпросмотр XML
              </div>
              <pre className="text-[10px] font-mono text-alfa-charcoal bg-alfa-gray-bg border border-alfa-gray-light rounded-lg p-3 max-h-64 overflow-auto whitespace-pre-wrap break-all">
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

function MessageBubble({
  m,
  onLoadProject,
  loading,
}: {
  m: ChatMessage;
  onLoadProject: (p: GanttProject, name: string) => void;
  loading: boolean;
}) {
  const [xmlExpanded, setXmlExpanded] = useState(false);

  // Split content: text before XML, XML block, text after XML
  // Also matches an unterminated <Project> while streaming
  const xmlMatch = m.content.match(/<Project[\s\S]*?(?:<\/Project>|$)/);
  const xmlComplete = /<\/Project>/.test(m.content);
  const hasXml = m.role === "assistant" && xmlMatch;

  let beforeXml = m.content;
  let xmlContent = "";
  let afterXml = "";

  if (hasXml && xmlMatch) {
    const idx = m.content.indexOf(xmlMatch[0]);
    beforeXml = m.content.slice(0, idx).trim();
    xmlContent = xmlMatch[0];
    afterXml = m.content.slice(idx + xmlMatch[0].length).trim();
  }

  return (
    <div
      className={cn(
        "flex",
        m.role === "user" ? "justify-end" : "justify-start",
      )}
    >
      {m.reasoning ? (
        <details open={!m.content} className="max-w-[85%] mb-1 rounded-lg border border-alfa-gray-light bg-alfa-gray-bg px-2.5 py-1.5">
          <summary className="text-[11px] text-alfa-gray cursor-pointer select-none">Рассуждения модели</summary>
          <div className="mt-1 text-[11px] text-alfa-gray whitespace-pre-wrap max-h-40 overflow-auto">{m.reasoning}</div>
        </details>
      ) : null}
      <div
        className={cn(
          "max-w-[85%] rounded-2xl px-3.5 py-2 text-[13px] leading-relaxed whitespace-pre-wrap break-words",
          m.role === "user"
            ? "bg-alfa-red text-white rounded-br-md"
            : "bg-white border border-alfa-gray-light text-alfa-charcoal rounded-bl-md",
        )}
      >
        {/* Loading dots */}
        {!m.content && (
          <span className="inline-flex gap-1 items-center py-1">
            <Dot /> <Dot delay="0.15s" /> <Dot delay="0.3s" />
          </span>
        )}

        {/* Text before XML */}
        {beforeXml && <span>{beforeXml}</span>}

        {/* Collapsible XML block */}
        {hasXml && (
          <div className="mt-2 border border-alfa-gray-light rounded-lg overflow-hidden">
            <button
              onClick={() => setXmlExpanded(!xmlExpanded)}
              className="w-full flex items-center gap-1.5 px-2.5 py-1.5 bg-alfa-gray-bg hover:bg-alfa-gray-light transition-colors text-[11px] text-alfa-gray font-medium"
            >
              {xmlExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
              <FileText className="w-3 h-3" />
              XML проекта ({xmlContent.length} символов)
            </button>
            {xmlExpanded && (
              <pre className="text-[10px] font-mono text-alfa-charcoal bg-white p-2 max-h-48 overflow-auto whitespace-pre-wrap break-all border-t border-alfa-gray-light">
                {xmlContent}
              </pre>
            )}
            {/* Apply button — shown once XML complete or stream finished */}
            {(xmlComplete || !loading) && (
              <div className="px-2.5 py-1.5 border-t border-alfa-gray-light bg-white">
                <button
                  onClick={() => {
                    if (!xmlMatch) return;
                    try {
                      const p = parseMsProjectXml(xmlMatch[0]);
                      onLoadProject(p, "ai-updated.xml");
                      toast.success("План обновлён", { description: `${p.tasks.length} задач` });
                    } catch {
                      toast.error("Не удалось применить XML");
                    }
                  }}
                  className="flex items-center gap-1.5 px-2.5 py-1 bg-alfa-red text-white rounded-md text-[11px] font-medium hover:bg-alfa-red-dark transition-colors"
                >
                  <Check className="w-3 h-3" />
                  Применить изменения
                </button>
              </div>
            )}
          </div>
        )}

        {/* Text after XML */}
        {afterXml && <span className="block mt-1">{afterXml}</span>}
        {m.ts && (
          <div
            className={cn(
              "text-[9px] mt-1 opacity-60",
              m.role === "user" ? "text-right" : "text-left",
            )}
          >
            {new Date(m.ts).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}
          </div>
        )}
      </div>
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
          ? "bg-white text-alfa-charcoal shadow-sm"
          : "text-alfa-gray hover:text-alfa-charcoal",
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
      className="inline-block w-1.5 h-1.5 rounded-full bg-alfa-gray animate-bounce"
      style={{ animationDelay: delay }}
    />
  );
}
