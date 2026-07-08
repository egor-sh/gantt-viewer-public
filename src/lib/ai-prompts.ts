/**
 * System prompts for different AI features.
 * Tailored for project management / Gantt chart domain.
 */

/** Serialize a GanttProject into compact text for the AI context. */
export function serializeProject(project: {
  title: string;
  startDate: Date;
  finishDate: Date;
  tasks: any[];
  resources: { uid: number; name: string }[];
}): string {
  const { title, startDate, finishDate, tasks, resources } = project;
  const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  const lines: string[] = [
    `Проект: "${title}"`,
    `Сроки: ${fmt(startDate)} → ${fmt(finishDate)}`,
    `Ресурсов: ${resources.length}`,
    "",
    "Задачи:",
  ];

  for (const t of tasks) {
    const flags: string[] = [];
    if (t.isSummary) flags.push("суммарная");
    if (t.isMilestone) flags.push("веха");
    if (t.isCritical) flags.push("критическая");
    const pct = `${t.percentComplete}%`;
    const res = t.resources.length ? ` | ${t.resources.join(", ")}` : "";
    const f = flags.length ? ` [${flags.join(", ")}]` : "";
    const indent = "  ".repeat(Math.max(0, (t.outlineLevel || 1) - 1));
    lines.push(`${indent}${t.outlineNumber} ${t.name}${f} | ${fmt(t.start)}—${fmt(t.finish)} | ${pct}${res}`);
  }

  if (resources.length) {
    lines.push("", "Ресурсы:", ...resources.map((r) => `  - ${r.name}`));
  }

  return lines.join("\n");
}

export const CHAT_SYSTEM_PROMPT = `Ты — AI-ассистент для управления проектами, встроенный в приложение "Просмотрщик диаграммы Ганта".

Твоя роль:
- Помогать анализировать проектные данные, сроки, загрузку ресурсов
- Отвечать на вопросы о задачах, связях, критическом пути
- Предлагать оптимизации и выявлять риски
- Отвечать кратко и по делу на русском языке

Когда пользователь загружает проект, ты получаешь его данные в виде структурированного текста.
Используй эти данные для ответов. Если данных недостаточно — скажи об этом.

Формат ответов: Markdown. Используй списки, таблицы, **жирный** для важного.`;

export const ANALYSIS_SYSTEM_PROMPT = `Ты — эксперт по управлению проектами. Проанализируй предоставленный проект и выдели:

1. **Критические риски** — задачи на критическом пути, которые могут сорвать сроки
2. **Перегрузка ресурсов** — кто перегружен задачами, конфликты
3. **Узкие места** — зависимости, блокирующие работу
4. **Рекомендации** — конкретные предложения по оптимизации (3-5 пунктов)

Отвечай на русском языке, формат — Markdown с заголовками и списками.`;

export const GENERATION_SYSTEM_PROMPT = `Ты — генератор проектов для MS Project. По описанию создай XML в формате MSPDI (Microsoft Project XML Interchange).

Требования к XML:
- Корневой элемент <Project>
- Внутри <Tasks> — элементы <Task> с полями: UID, ID, Name, Start, Finish, Duration, OutlineLevel, OutlineNumber, Summary, Milestone, Critical, PercentComplete
- Даты в формате ISO 8601 (2024-01-15T08:00:00)
- Duration в формате PT<n>H (часы)
- Внутри <Resources> — элементы <Resource> с UID и Name
- Внутри <Assignments> — связи TaskUID → ResourceUID
- Суммарные задачи (Summary=1) объединяют подзадачи
- Вехи (Milestone=1) имеют длительность PT0H
- Связи между задачами через <PredecessorLink> с Type (1=FS, 2=SS, 3=FF, 4=SF)

Верни ТОЛЬКО XML, без объяснений.`;
