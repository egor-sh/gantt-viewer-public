'use client';

import { useCallback, useRef, useState } from "react";
import { Upload, FileText, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { parseMsProjectXml, type GanttProject } from "@/lib/ms-project-parser";

interface Props {
  onLoad: (project: GanttProject, fileName: string) => void;
  onError: (message: string) => void;
}

export function FileUploader({ onLoad, onError }: Props) {
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(
    async (file: File) => {
      setLoading(true);
      try {
        const lower = file.name.toLowerCase();
        if (lower.endsWith(".mpp")) {
          onError(
            "Бинарный формат .mpp — закрытый стандарт Microsoft. Откройте файл в MS Project (или Project Libre / Merlin) и сохраните как XML (Файл → Сохранить как → XML).",
          );
          return;
        }
        if (!lower.endsWith(".xml")) {
          onError("Поддерживаются только файлы .xml (MS Project XML interchange format).");
          return;
        }
        const text = await file.text();
        const project = parseMsProjectXml(text);
        if (project.tasks.length === 0) {
          onError("В файле не найдено ни одной задачи. Возможно, это не MS Project XML.");
          return;
        }
        onLoad(project, file.name);
      } catch (e) {
        onError(e instanceof Error ? e.message : "Не удалось прочитать файл.");
      } finally {
        setLoading(false);
      }
    },
    [onLoad, onError],
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const file = e.dataTransfer.files?.[0];
      if (file) handleFile(file);
    },
    [handleFile],
  );

  return (
    <div
      className={cn(
        "border-2 border-dashed rounded-xl p-8 text-center transition-colors cursor-pointer",
        dragging ? "border-emerald-500 bg-emerald-50" : "border-slate-300 bg-slate-50/50 hover:bg-slate-50",
      )}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      onClick={() => inputRef.current?.click()}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".xml,.mpp"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFile(f);
          e.target.value = "";
        }}
      />
      <div className="flex flex-col items-center gap-3">
        <div className="w-12 h-12 rounded-full bg-emerald-100 flex items-center justify-center">
          {loading ? (
            <div className="w-5 h-5 border-2 border-emerald-600 border-t-transparent rounded-full animate-spin" />
          ) : (
            <Upload className="w-5 h-5 text-emerald-600" />
          )}
        </div>
        <div>
          <p className="text-sm font-medium text-slate-900">
            Перетащите сюда файл Microsoft Project
          </p>
          <p className="text-xs text-slate-500 mt-1">
            или нажмите, чтобы выбрать файл .xml
          </p>
        </div>
        <div className="flex items-center gap-1.5 mt-1 text-[11px] text-slate-400">
          <FileText className="w-3 h-3" />
          <span>MS Project XML (.xml)</span>
        </div>
      </div>
    </div>
  );
}

export function FormatNotice() {
  return (
    <div className="flex gap-2 items-start text-xs text-slate-500 bg-amber-50/60 border border-amber-200 rounded-md p-3">
      <AlertCircle className="w-4 h-4 shrink-0 text-amber-600 mt-0.5" />
      <div>
        <p className="font-medium text-amber-800 mb-0.5">Как получить XML из .mpp</p>
        <p>
          В Microsoft Project: <span className="font-mono">Файл → Сохранить как →</span> выберите формат
          <span className="font-mono"> XML (*.xml)</span>. Аналогично в Project Libre и Merlin Project.
          Бинарный .mpp формат закрыт и не поддерживается напрямую в браузере.
        </p>
      </div>
    </div>
  );
}
