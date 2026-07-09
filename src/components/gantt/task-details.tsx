'use client';

import { format } from "date-fns";
import { X, Calendar, Clock, Users, AlertTriangle, Flag, GitBranch, StickyNote } from "lucide-react";
import type { GanttProject, GanttTask } from "@/lib/ms-project-parser";
import { cn } from "@/lib/utils";

interface Props {
  task: GanttTask | null;
  project: GanttProject;
  onClose: () => void;
}

function fmtDuration(hours: number): string {
  if (hours <= 0) return "0ч (веха)";
  const days = Math.floor(hours / 8);
  const rem = hours - days * 8;
  if (days === 0) return `${rem}ч`;
  if (rem === 0) return `${days} раб. дн.`;
  return `${days} раб. дн. ${rem}ч`;
}

const LINK_TYPE_LABEL: Record<string, string> = {
  FS: "Финиш → Старт",
  SS: "Старт → Старт",
  FF: "Финиш → Финиш",
  SF: "Старт → Финиш",
};

export function TaskDetails({ task, project, onClose }: Props) {
  if (!task) return null;

  const predecessors = task.predecessors
    .map((p) => project.tasks.find((t) => t.uid === p.fromUid))
    .filter(Boolean) as GanttTask[];
  const successors = project.tasks.filter((t) =>
    t.predecessors.some((p) => p.fromUid === task.uid),
  );

  return (
    <aside className="w-80 shrink-0 border-l border-alfa-gray-light bg-white overflow-y-auto" style={{ maxHeight: "70vh" }}>
      <div className="sticky top-0 bg-white border-b border-alfa-gray-light px-4 py-3 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[11px] uppercase tracking-wide text-alfa-gray font-semibold">
            Задача #{task.id} · UID {task.uid}
          </div>
          <h3 className="font-semibold text-alfa-charcoal text-sm leading-tight mt-0.5 break-words">
            {task.name}
          </h3>
        </div>
        <button
          onClick={onClose}
          className="text-alfa-gray hover:text-alfa-charcoal transition-colors p-1 -m-1 shrink-0"
          aria-label="Закрыть панель"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="p-4 space-y-4">
        {/* Badges */}
        <div className="flex flex-wrap gap-1.5">
          {task.isSummary && (
            <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-alfa-gray-light text-alfa-charcoal font-medium">
              <Flag className="w-3 h-3" /> Суммарная
            </span>
          )}
          {task.isMilestone && (
            <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-alfa-red/10 text-alfa-red-dark font-medium">
              <Flag className="w-3 h-3" /> Веха
            </span>
          )}
          {task.isCritical && (
            <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-alfa-red/10 text-alfa-red-dark font-medium">
              <AlertTriangle className="w-3 h-3" /> Критическая
            </span>
          )}
          <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-alfa-gray-light text-alfa-gray font-mono">
            {task.outlineNumber}
          </span>
        </div>

        {/* Progress */}
        <div>
          <div className="flex justify-between items-baseline mb-1">
            <span className="text-[11px] uppercase tracking-wide text-alfa-gray font-semibold">
              Готовность
            </span>
            <span className="text-sm font-semibold text-alfa-charcoal tabular-nums">
              {task.percentComplete}%
            </span>
          </div>
          <div className="h-2 bg-alfa-gray-light rounded-full overflow-hidden">
            <div
              className={cn(
                "h-full rounded-full transition-all",
                task.isCritical ? "bg-alfa-red-dark" : "bg-alfa-red/100",
              )}
              style={{ width: `${task.percentComplete}%` }}
            />
          </div>
        </div>

        {/* Dates */}
        <div className="space-y-2">
          <Row icon={<Calendar className="w-4 h-4" />} label="Начало">
            {format(task.start, "dd.MM.yyyy")}
            <span className="text-alfa-gray ml-1">{format(task.start, "HH:mm")}</span>
          </Row>
          <Row icon={<Calendar className="w-4 h-4" />} label="Конец">
            {format(task.finish, "dd.MM.yyyy")}
            <span className="text-alfa-gray ml-1">{format(task.finish, "HH:mm")}</span>
          </Row>
          <Row icon={<Clock className="w-4 h-4" />} label="Длительность">
            {fmtDuration(task.durationHours)}
          </Row>
        </div>

        {/* Resources */}
        {task.resources.length > 0 && (
          <div>
            <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-alfa-gray font-semibold mb-1.5">
              <Users className="w-3.5 h-3.5" /> Ресурсы
            </div>
            <div className="flex flex-wrap gap-1">
              {task.resources.map((r) => (
                <span key={r} className="text-[11px] px-2 py-0.5 rounded bg-alfa-gray-light text-alfa-charcoal">
                  {r}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Dependencies */}
        {(predecessors.length > 0 || successors.length > 0) && (
          <div>
            <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-alfa-gray font-semibold mb-1.5">
              <GitBranch className="w-3.5 h-3.5" /> Связи
            </div>
            {predecessors.length > 0 && (
              <div className="mb-2">
                <div className="text-[11px] text-alfa-gray mb-1">Предшественники:</div>
                <ul className="space-y-1">
                  {task.predecessors.map((p, i) => {
                    const pred = predecessors[i];
                    return (
                      <li key={i} className="text-[12px] flex items-baseline gap-1.5">
                        <span className="text-alfa-charcoal font-medium truncate flex-1">{pred?.name ?? `#${p.fromUid}`}</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-alfa-gray-light text-alfa-gray font-mono shrink-0">
                          {LINK_TYPE_LABEL[p.type]}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
            {successors.length > 0 && (
              <div>
                <div className="text-[11px] text-alfa-gray mb-1">Преемники:</div>
                <ul className="space-y-1">
                  {successors.map((s) => {
                    const link = s.predecessors.find((p) => p.fromUid === task.uid)!;
                    return (
                      <li key={s.uid} className="text-[12px] flex items-baseline gap-1.5">
                        <span className="text-alfa-charcoal font-medium truncate flex-1">{s.name}</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-alfa-gray-light text-alfa-gray font-mono shrink-0">
                          {LINK_TYPE_LABEL[link.type]}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </div>
        )}

        {/* Notes */}
        {task.notes && (
          <div>
            <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-alfa-gray font-semibold mb-1.5">
              <StickyNote className="w-3.5 h-3.5" /> Заметки
            </div>
            <p className="text-[12px] text-alfa-charcoal whitespace-pre-wrap leading-relaxed">
              {task.notes}
            </p>
          </div>
        )}
      </div>
    </aside>
  );
}

function Row({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 text-[12px]">
      <span className="text-alfa-gray">{icon}</span>
      <span className="text-alfa-gray w-24 shrink-0">{label}</span>
      <span className="font-medium text-alfa-charcoal tabular-nums flex-1">{children}</span>
    </div>
  );
}
