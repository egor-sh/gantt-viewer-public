/**
 * Microsoft Project XML (MSPDI) parser.
 *
 * Reference: MS Project XML Interchange Format (Schema:mspdi.xsd).
 * The XML is exported by Microsoft Project via "File → Save As → XML".
 *
 * This parser intentionally covers only the fields needed for a viewer:
 *   - Task UID / ID / Name
 *   - Start / Finish / Duration
 *   - Outline level & outline number (hierarchy)
 *   - Summary / Milestone flags
 *   - Percent complete
 *   - Critical flag
 *   - Predecessor links (FS / SS / FF / SF)
 *   - Resources (Assignments → Resource name)
 *
 * The .mpp binary format is proprietary and not supported — export to XML
 * from MS Project first (or Merlin / Project Libre / OmniPlan all export
 * the same schema).
 */

export type LinkType = "FS" | "SS" | "FF" | "SF";

export interface PredecessorLink {
  fromUid: number; // UID of the predecessor task
  toUid: number;   // UID of the successor task (the owner of the link)
  type: LinkType;
}

export interface GanttTask {
  uid: number;
  id: number;
  name: string;
  start: Date;
  finish: Date;
  durationHours: number;
  outlineLevel: number;
  outlineNumber: string;
  isSummary: boolean;
  isMilestone: boolean;
  isCritical: boolean;
  percentComplete: number; // 0..100
  notes?: string;
  resources: string[];
  predecessors: PredecessorLink[];
  // Runtime helpers
  children: GanttTask[];
  collapsed?: boolean;
}

export interface GanttProject {
  title: string;
  startDate: Date;
  finishDate: Date;
  tasks: GanttTask[]; // flat list, but each task has .children built from outline numbers
  resources: { uid: number; name: string }[];
}

const LINK_TYPE_MAP: Record<number, LinkType> = {
  1: "FS",
  2: "SS",
  3: "FF",
  4: "SF",
};

/** Parse ISO-8601 duration like "PT40H", "P5D", "PT8H0M0S" into hours. */
export function parseDurationToHours(value: string | null | undefined): number {
  if (!value) return 0;
  // MS Project usually emits "PT<n>H" for working hours.
  const m = value.match(
    /P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?/,
  );
  if (!m) return 0;
  const days = parseInt(m[1] || "0", 10);
  const hours = parseInt(m[2] || "0", 10);
  const minutes = parseInt(m[3] || "0", 10);
  // MS Project "1 day" = 8 working hours by convention
  return days * 8 + hours + minutes / 60;
}

function text(node: Element | null | undefined, tag: string): string | null {
  if (!node) return null;
  const el = node.getElementsByTagName(tag)[0];
  return el?.textContent?.trim() ?? null;
}

function bool(node: Element, tag: string): boolean {
  return (text(node, tag) ?? "0") === "1" || (text(node, tag) ?? "false").toLowerCase() === "true";
}

function num(node: Element, tag: string): number | null {
  const v = text(node, tag);
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}

function date(node: Element, tag: string): Date | null {
  const v = text(node, tag);
  if (!v) return null;
  // MS Project uses ISO with optional timezone. `new Date()` parses it.
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Parse an MS Project XML string into a normalized GanttProject. */
export function parseMsProjectXml(xml: string): GanttProject {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const err = doc.getElementsByTagName("parsererror")[0];
  if (err) throw new Error("Не удалось разобрать XML: файл повреждён или не является XML.");

  const projectEl = doc.getElementsByTagName("Project")[0];
  if (!projectEl) throw new Error("В файле нет корневого элемента <Project> — это не MS Project XML.");

  const title =
    text(projectEl, "Title") ||
    text(projectEl, "Name") ||
    "Без названия";
  const startDate = date(projectEl, "StartDate") ?? new Date();
  const finishDate = date(projectEl, "FinishDate") ?? new Date();

  // Resources
  const resources: { uid: number; name: string }[] = [];
  const resourcesEl = projectEl.getElementsByTagName("Resources")[0];
  if (resourcesEl) {
    const resourceEls = Array.from(resourcesEl.getElementsByTagName("Resource"));
    for (const r of resourceEls) {
      const uid = num(r, "UID");
      const name = text(r, "Name");
      if (uid != null && name) resources.push({ uid, name });
    }
  }

  // Assignments (Task UID → Resource UID)
  const taskToResources = new Map<number, string[]>();
  const assignmentsEl = projectEl.getElementsByTagName("Assignments")[0];
  if (assignmentsEl) {
    const aEls = Array.from(assignmentsEl.getElementsByTagName("Assignment"));
    for (const a of aEls) {
      const taskUid = num(a, "TaskUID");
      const resUid = num(a, "ResourceUID");
      if (taskUid == null || resUid == null) continue;
      const res = resources.find((r) => r.uid === resUid);
      if (!res) continue;
      const list = taskToResources.get(taskUid) ?? [];
      if (!list.includes(res.name)) list.push(res.name);
      taskToResources.set(taskUid, list);
    }
  }

  // Tasks
  const tasksEl = projectEl.getElementsByTagName("Tasks")[0];
  if (!tasksEl) {
    return { title, startDate, finishDate, tasks: [], resources };
  }
  const taskEls = Array.from(tasksEl.getElementsByTagName("Task")).filter(
    // skip nested <Task> elements that live inside <PredecessorLink> etc. (defensive)
    (el) => el.parentElement === tasksEl,
  );

  const tasks: GanttTask[] = [];
  for (const t of taskEls) {
    const uid = num(t, "UID") ?? tasks.length;
    const id = num(t, "ID") ?? tasks.length + 1;
    const name = text(t, "Name") ?? `(Задача ${id})`;
    const start = date(t, "Start") ?? startDate;
    const finish = date(t, "Finish") ?? start;
    const durationHours = parseDurationToHours(text(t, "Duration"));
    const outlineLevel = num(t, "OutlineLevel") ?? 1;
    const outlineNumber = text(t, "OutlineNumber") ?? String(id);
    const isSummary = bool(t, "Summary");
    const isMilestone = bool(t, "Milestone");
    const isCritical = bool(t, "Critical");
    const percentComplete = Math.round(num(t, "PercentComplete") ?? 0);
    const notes = text(t, "Notes") ?? undefined;

    const predecessors: PredecessorLink[] = [];
    const predEls = Array.from(t.getElementsByTagName("PredecessorLink"));
    for (const p of predEls) {
      const predUid = num(p, "PredecessorUID");
      const typeNum = num(p, "Type") ?? 1;
      if (predUid == null) continue;
      predecessors.push({
        fromUid: predUid,
        toUid: uid,
        type: LINK_TYPE_MAP[typeNum] ?? "FS",
      });
    }

    tasks.push({
      uid,
      id,
      name,
      start,
      finish,
      durationHours,
      outlineLevel,
      outlineNumber,
      isSummary,
      isMilestone,
      isCritical,
      percentComplete,
      notes,
      resources: taskToResources.get(uid) ?? [],
      predecessors,
      children: [],
    });
  }

  // Build hierarchy from outline numbers (e.g. "1", "1.1", "1.1.1")
  const byOutline = new Map(tasks.map((t) => [t.outlineNumber, t]));
  for (const t of tasks) {
    const parts = t.outlineNumber.split(".");
    if (parts.length > 1) {
      const parentNum = parts.slice(0, -1).join(".");
      const parent = byOutline.get(parentNum);
      if (parent && parent !== t) parent.children.push(t);
    }
  }

  return {
    title,
    startDate,
    finishDate,
    tasks,
    resources,
  };
}

/** Build a synthetic project so the user can see how it looks without uploading anything. */
export function demoProject(): GanttProject {
  const today = new Date();
  today.setHours(8, 0, 0, 0);
  const day = (n: number) => {
    const d = new Date(today);
    d.setDate(d.getDate() + n);
    d.setHours(17, 0, 0, 0);
    return d;
  };
  const dayStart = (n: number) => {
    const d = new Date(today);
    d.setDate(d.getDate() + n);
    d.setHours(8, 0, 0, 0);
    return d;
  };

  const tasks: GanttTask[] = [
    { uid: 1, id: 1, name: "Запуск продукта", start: dayStart(0), finish: day(20), durationHours: 160, outlineLevel: 1, outlineNumber: "1", isSummary: true, isMilestone: false, isCritical: false, percentComplete: 35, resources: [], predecessors: [], children: [] },
    { uid: 2, id: 2, name: "Анализ требований", start: dayStart(0), finish: day(3), durationHours: 32, outlineLevel: 2, outlineNumber: "1.1", isSummary: false, isMilestone: false, isCritical: true, percentComplete: 100, resources: ["Анна"], predecessors: [], children: [] },
    { uid: 3, id: 3, name: "Техническое задание", start: dayStart(3), finish: day(5), durationHours: 24, outlineLevel: 2, outlineNumber: "1.2", isSummary: false, isMilestone: false, isCritical: true, percentComplete: 80, resources: ["Игорь"], predecessors: [{ fromUid: 2, toUid: 3, type: "FS" }], children: [] },
    { uid: 4, id: 4, name: "Утверждение ТЗ", start: day(5), finish: day(5), durationHours: 0, outlineLevel: 2, outlineNumber: "1.3", isSummary: false, isMilestone: true, isCritical: true, percentComplete: 0, resources: [], predecessors: [{ fromUid: 3, toUid: 4, type: "FS" }], children: [] },
    { uid: 5, id: 5, name: "Разработка", start: dayStart(5), finish: day(15), durationHours: 80, outlineLevel: 2, outlineNumber: "1.4", isSummary: true, isMilestone: false, isCritical: false, percentComplete: 25, resources: [], predecessors: [{ fromUid: 4, toUid: 5, type: "FS" }], children: [] },
    { uid: 6, id: 6, name: "Дизайн интерфейса", start: dayStart(5), finish: day(9), durationHours: 32, outlineLevel: 3, outlineNumber: "1.4.1", isSummary: false, isMilestone: false, isCritical: false, percentComplete: 60, resources: ["Мария"], predecessors: [{ fromUid: 4, toUid: 6, type: "FS" }], children: [] },
    { uid: 7, id: 7, name: "Backend", start: dayStart(5), finish: day(12), durationHours: 56, outlineLevel: 3, outlineNumber: "1.4.2", isSummary: false, isMilestone: false, isCritical: true, percentComplete: 20, resources: ["Олег", "Петр"], predecessors: [{ fromUid: 4, toUid: 7, type: "FS" }], children: [] },
    { uid: 8, id: 8, name: "Frontend", start: dayStart(9), finish: day(14), durationHours: 40, outlineLevel: 3, outlineNumber: "1.4.3", isSummary: false, isMilestone: false, isCritical: false, percentComplete: 10, resources: ["Мария"], predecessors: [{ fromUid: 6, toUid: 8, type: "FS" }], children: [] },
    { uid: 9, id: 9, name: "Тестирование", start: dayStart(14), finish: day(18), durationHours: 32, outlineLevel: 2, outlineNumber: "1.5", isSummary: false, isMilestone: false, isCritical: true, percentComplete: 0, resources: ["Сергей"], predecessors: [{ fromUid: 7, toUid: 9, type: "FS" }, { fromUid: 8, toUid: 9, type: "FS" }], children: [] },
    { uid: 10, id: 10, name: "Релиз", start: day(20), finish: day(20), durationHours: 0, outlineLevel: 2, outlineNumber: "1.6", isSummary: false, isMilestone: true, isCritical: true, percentComplete: 0, resources: [], predecessors: [{ fromUid: 9, toUid: 10, type: "FS" }], children: [] },
  ];

  // rebuild children for demo
  const byOutline = new Map(tasks.map((t) => [t.outlineNumber, t]));
  for (const t of tasks) {
    const parts = t.outlineNumber.split(".");
    if (parts.length > 1) {
      const parent = byOutline.get(parts.slice(0, -1).join("."));
      if (parent && parent !== t) parent.children.push(t);
    }
  }

  return {
    title: "Демо-проект: Запуск продукта",
    startDate: today,
    finishDate: day(20),
    tasks,
    resources: [
      { uid: 1, name: "Анна" },
      { uid: 2, name: "Игорь" },
      { uid: 3, name: "Мария" },
      { uid: 4, name: "Олег" },
      { uid: 5, name: "Петр" },
      { uid: 6, name: "Сергей" },
    ],
  };
}

// ── Serialize project back to MSPDI XML ───────────────────────────────────

const LINK_TYPE_REVERSE: Record<LinkType, number> = {
  FS: 1,
  SS: 2,
  FF: 3,
  SF: 4,
};

function isoDateTime(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:00`;
}

function hoursToDuration(h: number): string {
  if (h <= 0) return "PT0H";
  return `PT${Math.round(h)}H`;
}

export function projectToXml(project: GanttProject): string {
  const { title, startDate, finishDate, tasks, resources } = project;

  const parts: string[] = [];
  parts.push('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>');
  parts.push('<Project>');
  parts.push(`  <Name>${escapeXml(title)}</Name>`);
  parts.push(`  <StartDate>${isoDateTime(startDate)}</StartDate>`);
  parts.push(`  <FinishDate>${isoDateTime(finishDate)}</FinishDate>`);

  // Tasks
  parts.push("  <Tasks>");
  for (const t of tasks) {
    parts.push("    <Task>");
    parts.push(`      <UID>${t.uid}</UID>`);
    parts.push(`      <ID>${t.id}</ID>`);
    parts.push(`      <Name>${escapeXml(t.name)}</Name>`);
    parts.push(`      <Start>${isoDateTime(t.start)}</Start>`);
    parts.push(`      <Finish>${isoDateTime(t.finish)}</Finish>`);
    parts.push(`      <Duration>${hoursToDuration(t.durationHours)}</Duration>`);
    parts.push(`      <OutlineLevel>${t.outlineLevel}</OutlineLevel>`);
    parts.push(`      <OutlineNumber>${t.outlineNumber}</OutlineNumber>`);
    parts.push(`      <Summary>${t.isSummary ? 1 : 0}</Summary>`);
    parts.push(`      <Milestone>${t.isMilestone ? 1 : 0}</Milestone>`);
    parts.push(`      <Critical>${t.isCritical ? 1 : 0}</Critical>`);
    parts.push(`      <PercentComplete>${t.percentComplete}</PercentComplete>`);
    if (t.notes) {
      parts.push(`      <Notes>${escapeXml(t.notes)}</Notes>`);
    }
    // Predecessor links
    for (const p of t.predecessors) {
      parts.push("      <PredecessorLink>");
      parts.push(`        <PredecessorUID>${p.fromUid}</PredecessorUID>`);
      parts.push(`        <SuccessorUID>${p.toUid}</SuccessorUID>`);
      parts.push(`        <Type>${LINK_TYPE_REVERSE[p.type]}</Type>`);
      parts.push("      </PredecessorLink>");
    }
    parts.push("    </Task>");
  }
  parts.push("  </Tasks>");

  // Resources
  if (resources.length > 0) {
    parts.push("  <Resources>");
    for (const r of resources) {
      parts.push("    <Resource>");
      parts.push(`      <UID>${r.uid}</UID>`);
      parts.push(`      <Name>${escapeXml(r.name)}</Name>`);
      parts.push("    </Resource>");
    }
    parts.push("  </Resources>");
  }

  // Assignments (task -> resource mapping)
  const assignments: { taskUid: number; resourceUid: number }[] = [];
  for (const t of tasks) {
    for (const rn of t.resources) {
      const res = resources.find((r) => r.name === rn);
      if (res) assignments.push({ taskUid: t.uid, resourceUid: res.uid });
    }
  }
  if (assignments.length > 0) {
    parts.push("  <Assignments>");
    for (let i = 0; i < assignments.length; i++) {
      const a = assignments[i];
      parts.push("    <Assignment>");
      parts.push(`      <UID>${i + 1}</UID>`);
      parts.push(`      <TaskUID>${a.taskUid}</TaskUID>`);
      parts.push(`      <ResourceUID>${a.resourceUid}</ResourceUID>`);
      parts.push("    </Assignment>");
    }
    parts.push("  </Assignments>");
  }

  parts.push("</Project>");
  return parts.join("\n");
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
