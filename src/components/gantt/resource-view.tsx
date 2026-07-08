'use client';

import { useMemo, useState, useCallback } from "react";
import { format, eachDayOfInterval, differenceInCalendarDays, isWeekend, parseISO, isValid } from "date-fns";
import { Users, CalendarPlus, Trash2, AlertTriangle, Plane, Clock } from "lucide-react";
import type { GanttProject, GanttTask } from "@/lib/ms-project-parser";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

// ── Types ──────────────────────────────────────────────────────────────────

export interface Vacation {
  id: string;
  resource: string;
  start: string; // ISO date yyyy-MM-dd
  end: string;   // ISO date yyyy-MM-dd
  note?: string;
}

export interface ResourceViewProps {
  project: GanttProject;
  vacations: Vacation[];
  onVacationsChange: (v: Vacation[]) => void;
}

interface ResourceStat {
  name: string;
  taskCount: number;
  totalHours: number;
  totalDays: number;
  tasks: { name: string; start: Date; finish: Date; hours: number; isCritical: boolean }[];
  busyRanges: { start: Date; finish: Date }[];
}

// ── Helpers ────────────────────────────────────────────────────────────────

function toISODate(d: Date): string {
  return format(d, "yyyy-MM-dd");
}

function parseDate(s: string): Date | null {
  if (!s) return null;
  const d = parseISO(s);
  return isValid(d) ? d : null;
}

/** Calculate per-resource statistics from the project tasks. */
function computeResourceStats(project: GanttProject): ResourceStat[] {
  const map = new Map<string, ResourceStat>();

  const ensure = (name: string): ResourceStat => {
    let s = map.get(name);
    if (!s) {
      s = { name, taskCount: 0, totalHours: 0, totalDays: 0, tasks: [], busyRanges: [] };
      map.set(name, s);
    }
    return s;
  };

  for (const t of project.tasks) {
    if (t.isSummary) continue;
    if (t.resources.length === 0) continue;
    const taskHours = t.durationHours / Math.max(t.resources.length, 1);
    for (const r of t.resources) {
      const s = ensure(r);
      s.taskCount++;
      s.totalHours += taskHours;
      s.tasks.push({ name: t.name, start: t.start, finish: t.finish, hours: Math.round(taskHours), isCritical: t.isCritical });
      s.busyRanges.push({ start: t.start, finish: t.finish });
    }
  }

  for (const s of map.values()) {
    s.totalDays = Math.round(s.totalHours / 8);
    s.tasks.sort((a, b) => a.start.getTime() - b.start.getTime());
  }

  return Array.from(map.values()).sort((a, b) => b.totalHours - a.totalHours);
}

/** Check if a vacation overlaps with any task assignment for that resource. */
function hasConflict(vac: Vacation, stat: ResourceStat | undefined): boolean {
  if (!stat) return false;
  const vStart = parseDate(vac.start);
  const vEnd = parseDate(vac.end);
  if (!vStart || !vEnd) return false;
  return stat.busyRanges.some((r) => vStart <= r.finish && vEnd >= r.start);
}

// ── Mini utilization bar ───────────────────────────────────────────────────

function UtilBar({ hours, maxHours }: { hours: number; maxHours: number }) {
  const pct = maxHours > 0 ? Math.min(100, (hours / maxHours) * 100) : 0;
  const color = pct > 80 ? "bg-rose-500" : pct > 50 ? "bg-amber-500" : "bg-emerald-500";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden min-w-[60px]">
        <div className={cn("h-full rounded-full transition-all", color)} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[11px] text-slate-500 tabular-nums w-16 text-right">{hours}ч</span>
    </div>
  );
}

// ── Component ──────────────────────────────────────────────────────────────

export function ResourceView({ project, vacations, onVacationsChange }: ResourceViewProps) {
  const stats = useMemo(() => computeResourceStats(project), [project]);
  const maxHours = useMemo(() => Math.max(...stats.map((s) => s.totalHours), 1), [stats]);

  // All resource names (from both tasks and existing vacations)
  const allNames = useMemo(() => {
    const set = new Set<string>();
    stats.forEach((s) => set.add(s.name));
    vacations.forEach((v) => set.add(v.resource));
    project.resources.forEach((r) => set.add(r.name));
    return Array.from(set).sort();
  }, [stats, vacations, project.resources]);

  // Add vacation form state
  const [newRes, setNewRes] = useState("");
  const [newStart, setNewStart] = useState("");
  const [newEnd, setNewEnd] = useState("");
  const [newNote, setNewNote] = useState("");

  const addVacation = useCallback(() => {
    if (!newRes || !newStart || !newEnd) {
      toast.error("Заполните имя ресурса и даты отпуска");
      return;
    }
    const s = parseDate(newStart);
    const e = parseDate(newEnd);
    if (!s || !e || e < s) {
      toast.error("Дата окончания не может быть раньше начала");
      return;
    }
    onVacationsChange([
      ...vacations,
      { id: crypto.randomUUID(), resource: newRes, start: newStart, end: newEnd, note: newNote || undefined },
    ]);
    setNewStart("");
    setNewEnd("");
    setNewNote("");
    toast.success(`Отпуск добавлен: ${newRes}`);
  }, [newRes, newStart, newEnd, newNote, vacations, onVacationsChange]);

  const removeVacation = useCallback((id: string) => {
    onVacationsChange(vacations.filter((v) => v.id !== id));
  }, [vacations, onVacationsChange]);

  const sortedVacations = useMemo(
    () => [...vacations].sort((a, b) => a.start.localeCompare(b.start)),
    [vacations],
  );

  if (stats.length === 0 && project.tasks.length === 0) {
    return (
      <div className="text-center text-slate-400 py-20">
        <Users className="w-10 h-10 mx-auto mb-3 opacity-50" />
        <p>Нет данных. Загрузите проект для просмотра ресурсов.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ── Workload summary ─────────────────────────────────────────── */}
      <div>
        <h3 className="text-sm font-semibold text-slate-900 mb-3 flex items-center gap-1.5">
          <Users className="w-4 h-4 text-emerald-600" />
          Загруженность по ресурсам
        </h3>
        <div className="rounded-xl border border-slate-200 overflow-hidden bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                <th className="text-left font-medium px-4 py-2.5">Ресурс</th>
                <th className="text-center font-medium px-3 py-2.5">Задач</th>
                <th className="text-left font-medium px-4 py-2.5 min-w-[180px]">Загрузка</th>
                <th className="text-center font-medium px-3 py-2.5">Дней</th>
                <th className="text-left font-medium px-4 py-2.5">Занятость по датам</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {stats.map((s) => {
                const vCount = vacations.filter((v) => v.resource === s.name).length;
                return (
                  <tr key={s.name} className="hover:bg-slate-50/60">
                    <td className="px-4 py-2.5 font-medium text-slate-900">{s.name}</td>
                    <td className="px-3 py-2.5 text-center tabular-nums text-slate-600">{s.taskCount}</td>
                    <td className="px-4 py-2.5">
                      <UtilBar hours={s.totalHours} maxHours={maxHours} />
                    </td>
                    <td className="px-3 py-2.5 text-center tabular-nums text-slate-600">{s.totalDays}</td>
                    <td className="px-4 py-2.5">
                      <BusyTimeline stat={s} vacations={vacations.filter((v) => v.resource === s.name)} projectStart={project.startDate} projectEnd={project.finishDate} />
                    </td>
                  </tr>
                );
              })}
              {stats.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-slate-400">
                    В проекте нет назначенных ресурсов
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Detailed task breakdown ──────────────────────────────────── */}
      {stats.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-slate-900 mb-3 flex items-center gap-1.5">
            <Clock className="w-4 h-4 text-emerald-600" />
            Детализация задач
          </h3>
          <div className="rounded-xl border border-slate-200 overflow-hidden bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                  <th className="text-left font-medium px-4 py-2.5">Ресурс</th>
                  <th className="text-left font-medium px-4 py-2.5">Задача</th>
                  <th className="text-center font-medium px-3 py-2.5">Начало</th>
                  <th className="text-center font-medium px-3 py-2.5">Конец</th>
                  <th className="text-center font-medium px-3 py-2.5">Часы</th>
                  <th className="text-center font-medium px-3 py-2.5">Статус</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {stats.flatMap((s) =>
                  s.tasks.map((t, i) => (
                    <tr key={`${s.name}-${i}`} className="hover:bg-slate-50/60">
                      <td className="px-4 py-2 font-medium text-slate-900">{i === 0 ? s.name : ""}</td>
                      <td className="px-4 py-2 text-slate-700">{t.name}</td>
                      <td className="px-3 py-2 text-center tabular-nums text-slate-500 text-[12px]">{format(t.start, "dd.MM.yyyy")}</td>
                      <td className="px-3 py-2 text-center tabular-nums text-slate-500 text-[12px]">{format(t.finish, "dd.MM.yyyy")}</td>
                      <td className="px-3 py-2 text-center tabular-nums text-slate-600">{t.hours}</td>
                      <td className="px-3 py-2 text-center">
                        {t.isCritical && <span className="inline-block px-1.5 py-0.5 text-[10px] font-medium bg-rose-100 text-rose-700 rounded">критич.</span>}
                      </td>
                    </tr>
                  )),
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Vacations ───────────────────────────────────────────────── */}
      <div>
        <h3 className="text-sm font-semibold text-slate-900 mb-3 flex items-center gap-1.5">
          <Plane className="w-4 h-4 text-emerald-600" />
          Отпуска и отсутствия
        </h3>

        {/* Add form */}
        <div className="flex flex-wrap items-end gap-2 mb-3 bg-slate-50 border border-slate-200 rounded-lg p-3">
          <div className="flex flex-col gap-1">
            <label className="text-[10px] uppercase tracking-wide text-slate-400">Ресурс</label>
            <select
              value={newRes}
              onChange={(e) => setNewRes(e.target.value)}
              className="h-9 rounded-md border border-slate-300 bg-white px-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
            >
              <option value="">Выбрать…</option>
              {allNames.map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] uppercase tracking-wide text-slate-400">С</label>
            <Input type="date" value={newStart} onChange={(e) => setNewStart(e.target.value)} className="h-9 w-[150px]" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] uppercase tracking-wide text-slate-400">По</label>
            <Input type="date" value={newEnd} onChange={(e) => setNewEnd(e.target.value)} className="h-9 w-[150px]" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] uppercase tracking-wide text-slate-400">Комментарий</label>
            <Input value={newNote} onChange={(e) => setNewNote(e.target.value)} placeholder="необязательно" className="h-9 w-[160px]" />
          </div>
          <Button onClick={addVacation} size="sm" className="h-9">
            <CalendarPlus className="w-4 h-4 mr-1" />
            Добавить
          </Button>
        </div>

        {/* Vacation table */}
        <div className="rounded-xl border border-slate-200 overflow-hidden bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                <th className="text-left font-medium px-4 py-2.5">Ресурс</th>
                <th className="text-center font-medium px-3 py-2.5">С</th>
                <th className="text-center font-medium px-3 py-2.5">По</th>
                <th className="text-center font-medium px-3 py-2.5">Дней</th>
                <th className="text-left font-medium px-4 py-2.5">Комментарий</th>
                <th className="px-3 py-2.5"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sortedVacations.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                    Отпуска ещё не добавлены
                  </td>
                </tr>
              )}
              {sortedVacations.map((v) => {
                const stat = stats.find((s) => s.name === v.resource);
                const conflict = hasConflict(v, stat);
                const dStart = parseDate(v.start);
                const dEnd = parseDate(v.end);
                const days = dStart && dEnd ? differenceInCalendarDays(dEnd, dStart) + 1 : 0;
                return (
                  <tr key={v.id} className={cn("hover:bg-slate-50/60", conflict && "bg-rose-50/40")}>
                    <td className="px-4 py-2.5 font-medium text-slate-900 flex items-center gap-1.5">
                      {v.resource}
                      {conflict && (
                        <span title="Пересечение с задачей" className="inline-flex">
                          <AlertTriangle className="w-3.5 h-3.5 text-rose-500" />
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-center tabular-nums text-slate-600 text-[12px]">{v.start ? format(parseDate(v.start)!, "dd.MM.yyyy") : "—"}</td>
                    <td className="px-3 py-2.5 text-center tabular-nums text-slate-600 text-[12px]">{v.end ? format(parseDate(v.end)!, "dd.MM.yyyy") : "—"}</td>
                    <td className="px-3 py-2.5 text-center tabular-nums text-slate-600">{days}</td>
                    <td className="px-4 py-2.5 text-slate-500">{v.note || "—"}</td>
                    <td className="px-3 py-2.5 text-right">
                      <button
                        onClick={() => removeVacation(v.id)}
                        className="text-slate-400 hover:text-rose-500 transition-colors p-1 rounded"
                        title="Удалить"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {vacations.some((v) => {
          const stat = stats.find((s) => s.name === v.resource);
          return hasConflict(v, stat);
        }) && (
          <div className="flex items-center gap-2 mt-2 text-[12px] text-rose-600">
            <AlertTriangle className="w-3.5 h-3.5" />
            <span>Красным выделены отпуска, пересекающиеся с назначенными задачами.</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ── BusyTimeline mini-chart ────────────────────────────────────────────────

function BusyTimeline({
  stat,
  vacations,
  projectStart,
  projectEnd,
}: {
  stat: ResourceStat;
  vacations: Vacation[];
  projectStart: Date;
  projectEnd: Date;
}) {
  const days = useMemo(() => {
    const start = new Date(projectStart);
    start.setHours(0, 0, 0, 0);
    const end = new Date(projectEnd);
    end.setHours(0, 0, 0, 0);
    const diff = differenceInCalendarDays(end, start) + 1;
    return Math.max(diff, 1);
  }, [projectStart, projectEnd]);

  const startDate = useMemo(() => {
    const d = new Date(projectStart);
    d.setHours(0, 0, 0, 0);
    return d;
  }, [projectStart]);

  const isBusy = useCallback(
    (dayIdx: number) => {
      const day = new Date(startDate);
      day.setDate(day.getDate() + dayIdx);
      return stat.busyRanges.some((r) => {
        const rs = new Date(r.start); rs.setHours(0, 0, 0, 0);
        const re = new Date(r.finish); re.setHours(0, 0, 0, 0);
        return day >= rs && day <= re;
      });
    },
    [stat, startDate],
  );

  const isVacation = useCallback(
    (dayIdx: number) => {
      const day = new Date(startDate);
      day.setDate(day.getDate() + dayIdx);
      return vacations.some((v) => {
        const vs = parseDate(v.start);
        const ve = parseDate(v.end);
        if (!vs || !ve) return false;
        return day >= vs && day <= ve;
      });
    },
    [vacations, startDate],
  );

  // Render at most ~60 cells for readability
  const cellCount = Math.min(days, 60);
  const step = Math.ceil(days / cellCount);

  return (
    <div className="flex items-center gap-0.5">
      {Array.from({ length: cellCount }, (_, i) => {
        const dayIdx = i * step;
        const busy = isBusy(dayIdx);
        const vac = isVacation(dayIdx);
        return (
          <div
            key={i}
            className={cn(
              "h-3.5 rounded-sm transition-colors",
              vac ? "bg-sky-400" : busy ? "bg-emerald-500" : "bg-slate-100",
            )}
            style={{ width: `${100 / cellCount}%`, minWidth: "3px" }}
            title={format(new Date(startDate.getTime() + dayIdx * 86400000), "dd.MM.yyyy")}
          />
        );
      })}
    </div>
  );
}
