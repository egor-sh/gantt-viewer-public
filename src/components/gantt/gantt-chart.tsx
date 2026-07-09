'use client';

import { useMemo, useState, useCallback } from "react";
import { eachDayOfInterval, format, startOfDay, addDays, differenceInCalendarDays, isWeekend } from "date-fns";
import type { GanttProject, GanttTask, LinkType } from "@/lib/ms-project-parser";
import { cn } from "@/lib/utils";

export type Zoom = "day" | "week" | "month";

const ZOOM_PX: Record<Zoom, number> = {
  day: 36,
  week: 14,
  month: 5,
};

const ROW_H = 36;
const HEADER_H = 56;

interface Props {
  project: GanttProject;
  zoom: Zoom;
  onTaskClick?: (task: GanttTask) => void;
  selectedUid?: number | null;
}

/** Compute the visual time-span: min start → max finish (with 1-day padding). */
function useRange(project: GanttProject) {
  return useMemo(() => {
    const starts = project.tasks.map((t) => t.start.getTime());
    const finishes = project.tasks.map((t) => t.finish.getTime());
    const min = starts.length ? Math.min(...starts) : Date.now();
    const max = finishes.length ? Math.max(...finishes) : Date.now();
    const start = startOfDay(new Date(min - 1000 * 60 * 60 * 24)); // -1 day pad
    const end = startOfDay(addDays(new Date(max), 2)); // +2 days pad
    return { start, end };
  }, [project]);
}

function dateToX(date: Date, rangeStart: Date, dayWidth: number): number {
  const days = differenceInCalendarDays(date, rangeStart);
  return days * dayWidth;
}

/** Format duration in a human-friendly way. */
function fmtDuration(hours: number): string {
  if (hours <= 0) return "0ч";
  const days = Math.floor(hours / 8);
  const rem = hours - days * 8;
  if (days === 0) return `${rem}ч`;
  if (rem === 0) return `${days}д`;
  return `${days}д ${rem}ч`;
}

const LINK_TYPE_LABEL: Record<LinkType, string> = {
  FS: "Ф→Н",
  SS: "Н→Н",
  FF: "Ф→Ф",
  SF: "Н→Ф",
};

export function GanttChart({ project, zoom, onTaskClick, selectedUid }: Props) {
  // Local copy of tasks so we can toggle .collapsed on summary rows
  const [collapsedSet, setCollapsedSet] = useState<Set<number>>(new Set());
  const projectLocal = useMemo(() => {
    const tasks = project.tasks.map((t) => ({
      ...t,
      children: t.children.map((c) => ({ ...c })),
      collapsed: collapsedSet.has(t.uid),
    }));
    // Rebuild children arrays from outline numbers
    const byUid = new Map(tasks.map((t) => [t.uid, { ...t, children: [] as GanttTask[] }]));
    const roots: GanttTask[] = [];
    for (const t of tasks) {
      const parts = t.outlineNumber.split(".");
      if (parts.length === 1) {
        roots.push(byUid.get(t.uid)!);
      } else {
        const parentNum = parts.slice(0, -1).join(".");
        const parent = [...byUid.values()].find((x) => x.outlineNumber === parentNum);
        if (parent) parent.children.push(byUid.get(t.uid)!);
        else roots.push(byUid.get(t.uid)!);
      }
    }
    return { ...project, tasks, resources: project.resources };
  }, [project, collapsedSet]);

  const toggleCollapse = useCallback((uid: number) => {
    setCollapsedSet((prev) => {
      const next = new Set(prev);
      if (next.has(uid)) next.delete(uid);
      else next.add(uid);
      return next;
    });
  }, []);

  const range = useRange(projectLocal);
  const dayWidth = ZOOM_PX[zoom];
  const days = useMemo(
    () => eachDayOfInterval({ start: range.start, end: range.end }),
    [range],
  );
  const totalWidth = days.length * dayWidth;
  const [hoverUid, setHoverUid] = useState<number | null>(null);
  const todayX = dateToX(new Date(), range.start, dayWidth);

  // Flat visible task list (top-level + children of non-collapsed summaries)
  const flat = useMemo(() => {
    const out: { task: GanttTask; depth: number }[] = [];
    const walk = (tasks: GanttTask[], depth: number) => {
      for (const t of tasks) {
        out.push({ task: t, depth });
        if (t.children.length && !t.collapsed) {
          walk(t.children, depth + 1);
        }
      }
    };
    walk(projectLocal.tasks.filter((t) => t.outlineLevel === 1), 0);
    return out;
  }, [projectLocal]);

  const uidToY = useMemo(() => {
    const m = new Map<number, number>();
    flat.forEach(({ task }, i) => m.set(task.uid, i * ROW_H + ROW_H / 2));
    return m;
  }, [flat]);

  // Dependency arrows: build SVG paths
  const arrows = useMemo(() => {
    const out: { d: string; key: string; type: LinkType }[] = [];
    for (const { task } of flat) {
      for (const p of task.predecessors) {
        const from = projectLocal.tasks.find((x) => x.uid === p.fromUid);
        if (!from) continue;
        const fy = uidToY.get(from.uid);
        const ty = uidToY.get(task.uid);
        if (fy == null || ty == null) continue;
        const fs = dateToX(from.finish, range.start, dayWidth);
        const fstart = dateToX(from.start, range.start, dayWidth);
        const ts = dateToX(task.start, range.start, dayWidth);
        const tf = dateToX(task.finish, range.start, dayWidth);
        let x1 = 0, y1 = fy, x2 = 0, y2 = ty;
        switch (p.type) {
          case "FS": x1 = fs; y1 = fy; x2 = ts; y2 = ty; break;
          case "SS": x1 = fstart; y1 = fy; x2 = ts; y2 = ty; break;
          case "FF": x1 = fs; y1 = fy; x2 = tf; y2 = ty; break;
          case "SF": x1 = fstart; y1 = fy; x2 = tf; y2 = ty; break;
        }
        // Orthogonal routing: out from right side, vertical jog, into left side of successor
        const midX = Math.max(x1, x2) + 12;
        const d = `M ${x1} ${y1} L ${midX} ${y1} L ${midX} ${y2} L ${x2} ${y2}`;
        out.push({ d, key: `${from.uid}-${task.uid}-${p.type}`, type: p.type });
      }
    }
    return out;
  }, [flat, projectLocal, uidToY, range.start, dayWidth]);

  const tooltipTask = flat.find((x) => x.task.uid === hoverUid)?.task;

  return (
    <div className="relative overflow-auto border border-alfa-gray-light rounded-lg bg-white" style={{ maxHeight: "70vh" }}>
      <div className="flex" style={{ width: 480 + totalWidth, minWidth: "100%" }}>
        {/* LEFT: task table */}
        <div className="sticky left-0 z-20 bg-white border-r border-alfa-gray-light shrink-0" style={{ width: 480 }}>
          {/* Header */}
          <div className="sticky top-0 z-30 bg-alfa-gray-bg border-b border-alfa-gray-light flex items-end px-3" style={{ height: HEADER_H }}>
            <div className="grid grid-cols-[1fr_72px_72px_56px] w-full text-[11px] uppercase tracking-wide text-alfa-gray font-semibold pb-1.5">
              <div>Задача</div>
              <div className="text-right">Начало</div>
              <div className="text-right">Конец</div>
              <div className="text-right">%</div>
            </div>
          </div>
          {/* Rows */}
          {flat.map(({ task, depth }) => (
            <div
              key={task.uid}
              className={cn(
                "flex items-center px-3 border-b border-alfa-gray-light cursor-pointer transition-colors",
                selectedUid === task.uid ? "bg-alfa-red/10" : "hover:bg-alfa-gray-bg",
                task.isCritical && "bg-alfa-red/5",
              )}
              style={{ height: ROW_H }}
              onClick={() => onTaskClick?.(task)}
              onMouseEnter={() => setHoverUid(task.uid)}
              onMouseLeave={() => setHoverUid(null)}
            >
              <div
                className="grid grid-cols-[1fr_72px_72px_56px] w-full items-center text-[12px]"
                style={{ paddingLeft: depth * 16 }}
              >
                <div className="flex items-center gap-1.5 min-w-0">
                  {task.isSummary && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleCollapse(task.uid);
                      }}
                      className="text-alfa-gray hover:text-alfa-charcoal text-[10px] font-mono w-4 h-4 flex items-center justify-center shrink-0 transition-colors"
                      title={collapsedSet.has(task.uid) ? "Раскрыть" : "Свернуть"}
                    >
                      {collapsedSet.has(task.uid) ? "▸" : "▾"}
                    </button>
                  )}
                  {task.isMilestone ? (
                    <span className="text-alfa-red shrink-0">◆</span>
                  ) : task.isSummary ? (
                    <span className="text-alfa-charcoal shrink-0">▤</span>
                  ) : (
                    <span className="text-alfa-red shrink-0">▶</span>
                  )}
                  <span
                    className={cn(
                      "truncate",
                      task.isSummary ? "font-semibold text-alfa-charcoal" : "text-alfa-charcoal",
                      task.isMilestone && "font-semibold text-alfa-red-dark",
                    )}
                    title={task.name}
                  >
                    {task.name}
                  </span>
                </div>
                <div className="text-right text-alfa-gray tabular-nums">
                  {format(task.start, "dd.MM.yy")}
                </div>
                <div className="text-right text-alfa-gray tabular-nums">
                  {format(task.finish, "dd.MM.yy")}
                </div>
                <div className="text-right tabular-nums font-medium text-alfa-charcoal">
                  {task.percentComplete}%
                </div>
              </div>
            </div>
          ))}
          {flat.length === 0 && (
            <div className="p-6 text-sm text-alfa-gray">В проекте нет задач.</div>
          )}
        </div>

        {/* RIGHT: timeline */}
        <div className="relative shrink-0" style={{ width: totalWidth }}>
          {/* Time scale header */}
          <div className="sticky top-0 z-10 bg-white border-b border-alfa-gray-light" style={{ height: HEADER_H }}>
            <TimeScale days={days} dayWidth={dayWidth} zoom={zoom} />
          </div>
          {/* Grid + rows */}
          <div className="relative" style={{ height: flat.length * ROW_H }}>
            {/* Day grid lines */}
            <svg className="absolute inset-0" width={totalWidth} height={flat.length * ROW_H}>
              {days.map((d, i) => (
                <line
                  key={i}
                  x1={i * dayWidth}
                  y1={0}
                  x2={i * dayWidth}
                  y2={flat.length * ROW_H}
                  stroke={isWeekend(d) ? "#f1f5f9" : "#f8fafc"}
                  strokeWidth={1}
                />
              ))}
              {/* Row separators */}
              {flat.map((_, i) => (
                <line
                  key={`r${i}`}
                  x1={0}
                  y1={(i + 1) * ROW_H}
                  x2={totalWidth}
                  y2={(i + 1) * ROW_H}
                  stroke="#f8fafc"
                  strokeWidth={1}
                />
              ))}
              {/* Today line */}
              {todayX >= 0 && todayX <= totalWidth && (
                <line
                  x1={todayX}
                  y1={0}
                  x2={todayX}
                  y2={flat.length * ROW_H}
                  stroke="#ef4444"
                  strokeWidth={1.5}
                  strokeDasharray="4 3"
                />
              )}
            </svg>

            {/* Bars */}
            {flat.map(({ task }, i) => (
              <TaskBar
                key={task.uid}
                task={task}
                x={dateToX(task.start, range.start, dayWidth)}
                y={i * ROW_H}
                dayWidth={dayWidth}
                rangeStart={range.start}
                onClick={() => onTaskClick?.(task)}
                onHover={() => setHoverUid(task.uid)}
                onLeave={() => setHoverUid(null)}
                selected={selectedUid === task.uid}
              />
            ))}

            {/* Dependency arrows */}
            <svg
              className="absolute inset-0 pointer-events-none"
              width={totalWidth}
              height={flat.length * ROW_H}
            >
              <defs>
                <marker id="arrowhead" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
                  <polygon points="0 0, 6 3, 0 6" fill="#64748b" />
                </marker>
              </defs>
              {arrows.map((a) => (
                <path
                  key={a.key}
                  d={a.d}
                  fill="none"
                  stroke="#94a3b8"
                  strokeWidth={1.2}
                  markerEnd="url(#arrowhead)"
                />
              ))}
            </svg>
          </div>
        </div>
      </div>

      {/* Floating tooltip */}
      {tooltipTask && (
        <Tooltip task={tooltipTask} />
      )}
    </div>
  );
}

/** Time scale with two rows: month/year on top, day/week on bottom. */
function TimeScale({ days, dayWidth, zoom }: { days: Date[]; dayWidth: number; zoom: Zoom }) {
  // Group days into months
  const months = useMemo(() => {
    const groups: { label: string; startIdx: number; count: number }[] = [];
    for (let i = 0; i < days.length; i++) {
      const d = days[i];
      const label = format(d, "LLL yyyy");
      const last = groups[groups.length - 1];
      if (last && last.label === label) {
        last.count++;
      } else {
        groups.push({ label, startIdx: i, count: 1 });
      }
    }
    return groups;
  }, [days]);

  return (
    <svg width={days.length * dayWidth} height={HEADER_H}>
      {/* Months band */}
      {months.map((m, i) => (
        <g key={i}>
          <rect
            x={m.startIdx * dayWidth}
            y={0}
            width={m.count * dayWidth}
            height={24}
            fill={i % 2 === 0 ? "#f8fafc" : "#f1f5f9"}
          />
          <text
            x={m.startIdx * dayWidth + 4}
            y={16}
            fontSize={11}
            fontWeight={600}
            fill="#475569"
          >
            {m.label}
          </text>
          <line
            x1={m.startIdx * dayWidth + m.count * dayWidth}
            y1={0}
            x2={m.startIdx * dayWidth + m.count * dayWidth}
            y2={HEADER_H}
            stroke="#e2e8f0"
            strokeWidth={1}
          />
        </g>
      ))}
      {/* Days / weeks / months band */}
      {zoom === "day" && days.map((d, i) => (
        <g key={i}>
          {isWeekend(d) && (
            <rect
              x={i * dayWidth}
              y={24}
              width={dayWidth}
              height={HEADER_H - 24}
              fill="#fafafa"
            />
          )}
          <text
            x={i * dayWidth + dayWidth / 2}
            y={40}
            fontSize={10}
            fill="#64748b"
            textAnchor="middle"
          >
            {format(d, "d")}
          </text>
        </g>
      ))}
      {zoom === "week" && days.filter((_, i) => i % 7 === 0).map((d, i, arr) => {
        const x = days.indexOf(d) * dayWidth;
        const next = arr[i + 1];
        const endX = next ? days.indexOf(next) * dayWidth : days.length * dayWidth;
        return (
          <text
            key={i}
            x={x + 2}
            y={40}
            fontSize={10}
            fill="#64748b"
          >
            {format(d, "dd.MM")}
          </text>
        );
      })}
      {zoom === "month" && months.map((m, i) => (
        <text
          key={i}
          x={m.startIdx * dayWidth + 2}
          y={40}
          fontSize={10}
          fill="#64748b"
        >
          {format(days[m.startIdx], "dd.MM")}
        </text>
      ))}
      <line x1={0} y1={24} x2={days.length * dayWidth} y2={24} stroke="#e2e8f0" />
    </svg>
  );
}

/** A single task bar (or milestone diamond / summary bracket). */
function TaskBar({
  task,
  y,
  dayWidth,
  rangeStart,
  onClick,
  onHover,
  onLeave,
  selected,
}: {
  task: GanttTask;
  x: number;
  y: number;
  dayWidth: number;
  rangeStart: Date;
  onClick: () => void;
  onHover: () => void;
  onLeave: () => void;
  selected: boolean;
}) {
  const barH = 18;
  const barY = y + (ROW_H - barH) / 2;
  const start = dateToX(task.start, rangeStart, dayWidth);
  const end = dateToX(task.finish, rangeStart, dayWidth);
  const width = Math.max(end - start, dayWidth * 0.4);

  if (task.isMilestone) {
    const cx = start;
    const cy = barY + barH / 2;
    const s = 7;
    return (
      <svg
        className="absolute cursor-pointer"
        style={{ left: cx - s, top: barY, width: s * 2, height: barH, overflow: "visible" }}
        onClick={onClick}
        onMouseEnter={onHover}
        onMouseLeave={onLeave}
      >
        <polygon
          points={`0,${barH / 2} ${s},0 ${s * 2},${barH / 2} ${s},${barH}`}
          fill={task.isCritical ? "#dc2626" : "#f59e0b"}
          stroke={selected ? "#0f766e" : "#92400e"}
          strokeWidth={selected ? 2 : 1}
        />
      </svg>
    );
  }

  if (task.isSummary) {
    return (
      <div
        className="absolute cursor-pointer"
        style={{ left: start, top: barY, width, height: barH }}
        onClick={onClick}
        onMouseEnter={onHover}
        onMouseLeave={onLeave}
      >
        {/* Filled portion showing % complete */}
        <div
          className="absolute top-1/2 -translate-y-1/2 left-0 right-0 h-1.5 bg-alfa-charcoal/80 rounded-sm"
        />
        <div
          className="absolute top-1/2 -translate-y-1/2 h-1.5 bg-alfa-red/100 rounded-sm"
          style={{ width: `${task.percentComplete}%` }}
        />
        {/* End caps */}
        <div className="absolute -bottom-0.5 left-0 w-1 h-3 bg-alfa-charcoal" />
        <div className="absolute -bottom-0.5 right-0 w-1 h-3 bg-alfa-charcoal" />
      </div>
    );
  }

  // Regular task bar
  const fill = task.isCritical ? "#fee2e2" : "#d1fae5";
  const stroke = task.isCritical ? "#dc2626" : "#0f766e";
  const progressFill = task.isCritical ? "#dc2626" : "#10b981";

  return (
    <div
      className={cn(
        "absolute cursor-pointer rounded-sm border transition-shadow",
        selected && "ring-2 ring-offset-1 ring-alfa-red",
      )}
      style={{
        left: start,
        top: barY,
        width,
        height: barH,
        background: fill,
        borderColor: stroke,
      }}
      onClick={onClick}
      onMouseEnter={onHover}
      onMouseLeave={onLeave}
    >
      <div
        className="absolute left-0 top-0 bottom-0 rounded-l-sm"
        style={{
          width: `${task.percentComplete}%`,
          background: progressFill,
          opacity: 0.85,
        }}
      />
      {dayWidth >= 20 && (
        <span
          className="absolute inset-0 flex items-center px-1.5 text-[10px] font-medium text-alfa-charcoal truncate"
        >
          {task.percentComplete}%
        </span>
      )}
    </div>
  );
}

function Tooltip({ task }: { task: GanttTask }) {
  return (
    <div className="fixed bottom-4 right-4 z-50 max-w-sm bg-white border border-alfa-gray-light shadow-lg rounded-lg p-4 pointer-events-none">
      <div className="flex items-start gap-2 mb-2">
        {task.isMilestone && <span className="text-alfa-red">◆</span>}
        {task.isSummary && <span className="text-alfa-gray">▤</span>}
        <h3 className="font-semibold text-sm text-alfa-charcoal flex-1">{task.name}</h3>
      </div>
      <dl className="text-xs space-y-1">
        <div className="flex justify-between gap-4">
          <dt className="text-alfa-gray">Начало</dt>
          <dd className="font-medium tabular-nums">{format(task.start, "dd.MM.yyyy HH:mm")}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-alfa-gray">Конец</dt>
          <dd className="font-medium tabular-nums">{format(task.finish, "dd.MM.yyyy HH:mm")}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-alfa-gray">Длительность</dt>
          <dd className="font-medium">{fmtDuration(task.durationHours)}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-alfa-gray">Готовность</dt>
          <dd className="font-medium">{task.percentComplete}%</dd>
        </div>
        {task.resources.length > 0 && (
          <div className="flex justify-between gap-4">
            <dt className="text-alfa-gray">Ресурсы</dt>
            <dd className="font-medium text-right">{task.resources.join(", ")}</dd>
          </div>
        )}
        {task.isCritical && (
          <div className="text-alfa-red font-medium pt-1">⚡ Критическая задача</div>
        )}
        {task.isMilestone && (
          <div className="text-alfa-red font-medium pt-1">◆ Веха</div>
        )}
        {task.predecessors.length > 0 && (
          <div className="pt-1 border-t border-alfa-gray-light mt-1">
            <dt className="text-alfa-gray mb-0.5">Предшественники:</dt>
            {task.predecessors.map((p, i) => (
              <dd key={i} className="text-alfa-charcoal">
                #{p.fromUid} → {LINK_TYPE_LABEL[p.type]}
              </dd>
            ))}
          </div>
        )}
      </dl>
    </div>
  );
}
