'use client';

import { useState, useCallback, useEffect, useRef } from "react";
import { BarChart3, CalendarClock, ZoomIn, ZoomOut, CalendarRange, FileBarChart, Layers, AlertCircle, Users, Sparkles, Undo2, History, Save, ChevronDown } from "lucide-react";
import { FileUploader, FormatNotice } from "@/components/gantt/file-uploader";
import { GanttChart, type Zoom } from "@/components/gantt/gantt-chart";
import { TaskDetails } from "@/components/gantt/task-details";
import { ResourceView, type Vacation } from "@/components/gantt/resource-view";
import { AiPanel } from "@/components/gantt/ai-panel";
import { demoProject, parseMsProjectXml, projectToXml, type GanttProject, type GanttTask } from "@/lib/ms-project-parser";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

/* eslint-disable @typescript-eslint/no-explicit-any */

interface VersionEntry {
  id: string;
  timestamp: string;
  label: string;
}

export default function Home() {
  const [project, setProject] = useState<GanttProject | null>(null);
  const [fileName, setFileName] = useState<string>("");
  const [zoom, setZoom] = useState<Zoom>("day");
  const [selected, setSelected] = useState<GanttTask | null>(null);
  const [activeTab, setActiveTab] = useState("gantt");
  const [vacations, setVacations] = useState<Vacation[]>([]);

  // Versioning state
  const [versions, setVersions] = useState<VersionEntry[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [unsavedChanges, setUnsavedChanges] = useState(false);
  const fileNameRef = useRef<string>("");
  const projectRef = useRef<GanttProject | null>(null);

  // Keep refs in sync
  useEffect(() => { fileNameRef.current = fileName; }, [fileName]);
  useEffect(() => { projectRef.current = project; }, [project]);

  // Notify Electron main process about unsaved state
  useEffect(() => {
    const el = (window as any).electron;
    if (el?.setUnsavedChanges) {
      el.setUnsavedChanges(unsavedChanges);
    }
  }, [unsavedChanges]);

  // ── Load version list when fileName changes ──
  const refreshVersions = useCallback(async () => {
    const vf = (window as any).versions;
    if (!vf || !fileNameRef.current) return;
    try {
      const list = await vf.list(fileNameRef.current);
      setVersions(list || []);
    } catch {
      setVersions([]);
    }
  }, []);

  useEffect(() => {
    refreshVersions();
  }, [fileName, refreshVersions]);

  // ── Listen for save-before-quit signal from main process ──
  useEffect(() => {
    const el = (window as any).electron;
    if (!el?.onSaveBeforeQuit) return;

    el.onSaveBeforeQuit(() => {
      // Save current project as XML version, then confirm quit
      saveProjectVersion("Сохранение перед выходом");
      setUnsavedChanges(false);
      // Give the save a moment, then confirm quit
      setTimeout(() => {
        el.confirmQuit?.();
      }, 500);
    });
  }, []);

  // ── Push current project XML as a version ──
  const saveProjectVersion = useCallback(async (label: string = "Ручное сохранение") => {
    const vf = (window as any).versions;
    const proj = projectRef.current;
    if (!vf || !proj || !fileNameRef.current) return;

    try {
      const xml = projectToXml(proj);
      await vf.push(xml, fileNameRef.current, label);
      setUnsavedChanges(false);
      refreshVersions();
    } catch (e) {
      console.error("Failed to save version:", e);
    }
  }, [refreshVersions]);

  // ── Undo: restore previous version ──
  const handleUndo = useCallback(async () => {
    const vf = (window as any).versions;
    const proj = projectRef.current;
    if (!vf || !proj || !fileNameRef.current) {
      toast.error("Нет проекта для отката");
      return;
    }

    // Push current state first (so undo is reversible)
    const currentXml = projectToXml(proj);
    await vf.push(currentXml, fileNameRef.current, "Перед откатом");

    // Get the version before that (now second newest)
    const xml = await vf.previous(fileNameRef.current);
    if (!xml) {
      toast.error("Нет предыдущих версий");
      return;
    }

    try {
      const restored = parseMsProjectXml(xml);
      setProject(restored);
      setSelected(null);
      setUnsavedChanges(false);
      toast.success("Откат выполнен", {
        description: `${restored.tasks.length} задач восстановлено`,
      });
      refreshVersions();
    } catch {
      toast.error("Не удалось восстановить версию");
    }
  }, [refreshVersions]);

  // ── Restore specific version from history ──
  const handleRestoreVersion = useCallback(async (versionId: string) => {
    const vf = (window as any).versions;
    if (!vf || !fileNameRef.current) return;

    const xml = await vf.get(fileNameRef.current, versionId);
    if (!xml) {
      toast.error("Версия не найдена");
      return;
    }

    try {
      const restored = parseMsProjectXml(xml);
      setProject(restored);
      setSelected(null);
      setUnsavedChanges(true);
      setHistoryOpen(false);
      toast.success("Версия восстановлена", {
        description: format(new Date(versions.find(v => v.id === versionId)?.timestamp || Date.now()), "dd.MM.yyyy HH:mm"),
      });
    } catch {
      toast.error("Не удалось восстановить версию");
    }
  }, [versions]);

  const handleLoad = useCallback((p: GanttProject, name: string) => {
    setProject(p);
    setFileName(name);
    setSelected(null);
    setActiveTab("gantt");
    setUnsavedChanges(false);
    toast.success(`Загружено: ${name}`, {
      description: `${p.tasks.length} задач · ${p.resources.length} ресурсов`,
    });
  }, []);

  const handleError = useCallback((msg: string) => {
    toast.error("Не удалось загрузить файл", { description: msg });
  }, []);

  const loadDemo = useCallback(() => {
    setProject(demoProject());
    setFileName("demo-project.xml");
    setSelected(null);
    setActiveTab("gantt");
    setUnsavedChanges(false);
    toast("Загружен демо-проект");
  }, []);

  const reset = useCallback(() => {
    setProject(null);
    setFileName("");
    setSelected(null);
    setVacations([]);
    setActiveTab("gantt");
    setUnsavedChanges(false);
    setVersions([]);
  }, []);

  // ── Wrap onLoadProject to auto-save version on AI changes ──
  const handleLoadWithVersioning = useCallback((p: GanttProject, name: string) => {
    // If loading from AI (updating existing project), save a version first
    const vf = (window as any).versions;
    const oldProj = projectRef.current;
    const oldName = fileNameRef.current;

    if (vf && oldProj && oldName && oldName === name) {
      // Same file updated by AI — push current state as a version
      const xml = projectToXml(oldProj);
      vf.push(xml, oldName, "Перед изменением AI").then(() => {
        refreshVersions();
      }).catch(() => {});
    }

    setProject(p);
    setFileName(name);
    setSelected(null);
    setUnsavedChanges(true);
    toast.success(`Загружено: ${name}`, {
      description: `${p.tasks.length} задач · ${p.resources.length} ресурсов`,
    });
  }, [refreshVersions]);

  const stats = project ? computeStats(project) : null;

  return (
    <div className="min-h-screen flex flex-col bg-alfa-gray-bg">
      {/* Header — Alfa Bank style: dark charcoal bar with red accent */}
      <header className="bg-alfa-charcoal text-white sticky top-0 z-40 border-b border-alfa-slate" style={{ paddingLeft: "78px" }}>
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-lg bg-alfa-red flex items-center justify-center shrink-0 shadow-md">
              <BarChart3 className="w-5 h-5 text-white" />
            </div>
            <div className="min-w-0">
              <h1 className="font-semibold text-white text-base sm:text-lg leading-tight truncate">
                Просмотрщик диаграммы Ганта
              </h1>
              <p className="text-[11px] text-alfa-gray leading-tight">
                Microsoft Project XML · для macOS
              </p>
            </div>
          </div>
          {project && (
            <div className="flex items-center gap-2">
              {/* Undo button */}
              <Button
                variant="outline"
                size="sm"
                onClick={handleUndo}
                disabled={versions.length === 0}
                className="border-alfa-slate text-white hover:bg-alfa-slate hover:text-white"
                title="Откатить к предыдущей версии"
              >
                <Undo2 className="w-4 h-4 mr-1.5" />
                Откатить
              </Button>
              {/* History dropdown */}
              <div className="relative">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setHistoryOpen(!historyOpen)}
                  disabled={versions.length === 0}
                  className="border-alfa-slate text-white hover:bg-alfa-slate hover:text-white"
                  title="История версий"
                >
                  <History className="w-4 h-4 mr-1.5" />
                  История
                  <ChevronDown className="w-3 h-3 ml-1" />
                </Button>
                {historyOpen && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setHistoryOpen(false)} />
                    <div className="absolute right-0 top-full mt-1 z-50 bg-white rounded-lg shadow-xl border border-alfa-gray-light min-w-[280px] max-h-[360px] overflow-y-auto">
                      <div className="px-3 py-2 text-[11px] uppercase tracking-wide text-alfa-gray border-b border-alfa-gray-light bg-alfa-gray-bg sticky top-0">
                        Последние версии ({versions.length}/5)
                      </div>
                      {versions.map((v, i) => (
                        <button
                          key={v.id}
                          onClick={() => handleRestoreVersion(v.id)}
                          className="w-full text-left px-3 py-2 hover:bg-alfa-gray-bg transition-colors border-b border-alfa-gray-light/50 last:border-0"
                        >
                          <div className="flex items-center gap-2">
                            <span className="w-6 h-6 rounded-full bg-alfa-red/10 text-alfa-red flex items-center justify-center text-[10px] font-bold shrink-0">
                              {versions.length - i}
                            </span>
                            <div className="min-w-0">
                              <div className="text-[12px] font-medium text-alfa-charcoal truncate">{v.label}</div>
                              <div className="text-[10px] text-alfa-gray">{format(new Date(v.timestamp), "dd.MM.yyyy HH:mm:ss")}</div>
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
              {/* Save button */}
              <Button
                variant="outline"
                size="sm"
                onClick={() => saveProjectVersion("Ручное сохранение")}
                className={cn(
                  "border-alfa-slate text-white hover:bg-alfa-slate hover:text-white",
                  unsavedChanges && "border-alfa-red/50 ring-1 ring-alfa-red/30",
                )}
                title="Сохранить версию"
              >
                <Save className="w-4 h-4 mr-1.5" />
                {unsavedChanges ? "Сохранить *" : "Сохранить"}
              </Button>
              <Button variant="outline" size="sm" onClick={loadDemo} className="border-alfa-slate text-white hover:bg-alfa-slate hover:text-white">
                <Layers className="w-4 h-4 mr-1.5" />
                Демо
              </Button>
              <Button variant="outline" size="sm" onClick={reset} className="border-alfa-slate text-white hover:bg-alfa-slate hover:text-white">
                <FileBarChart className="w-4 h-4 mr-1.5" />
                Другой файл
              </Button>
            </div>
          )}
        </div>
        {/* Red accent strip — Alfa Bank signature */}
        <div className="h-0.5 bg-alfa-red w-full" />
      </header>

      <main className="flex-1 max-w-[1600px] w-full mx-auto px-4 sm:px-6 py-6">
        {!project ? (
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList>
              <TabsTrigger value="gantt">
                <FileBarChart className="w-3.5 h-3.5" />
                Открыть файл
              </TabsTrigger>
              <TabsTrigger value="ai">
                <Sparkles className="w-3.5 h-3.5" />
                AI-ассистент
              </TabsTrigger>
            </TabsList>

            <TabsContent value="gantt">
              <div className="max-w-2xl mx-auto space-y-6">
                <div className="text-center">
                  <h2 className="text-xl sm:text-2xl font-semibold text-alfa-black">
                    Откройте файл Microsoft Project
                  </h2>
                  <p className="text-sm text-alfa-gray mt-1.5 max-w-md mx-auto">
                    Простой просмотрщик файлов <code className="text-alfa-charcoal bg-alfa-gray-light px-1.5 py-0.5 rounded text-[12px]">.xml</code> из MS Project.
                    Работает локально — ничего не устанавливается, файлы никуда не отправляются.
                  </p>
                </div>

                <FileUploader onLoad={handleLoad} onError={handleError} />

                <FormatNotice />

                <div className="pt-2">
                  <Button onClick={loadDemo} variant="default" className="w-full bg-alfa-red hover:bg-alfa-red-dark text-white" size="lg">
                    <Layers className="w-4 h-4 mr-2" />
                    Открыть демо-проект
                  </Button>
                </div>

                <div className="grid grid-cols-3 gap-3 pt-4 text-center">
                  <Feature icon={<FileBarChart className="w-4 h-4" />} title="XML-формат" desc="Открывается напрямую из MS Project" />
                  <Feature icon={<CalendarClock className="w-4 h-4" />} title="Таймлайн" desc="Дни, недели, месяцы" />
                  <Feature icon={<Sparkles className="w-4 h-4" />} title="AI-ассистент" desc="Анализ, генерация, чат" />
                </div>
              </div>
            </TabsContent>

            <TabsContent value="ai">
              <AiPanel project={project} onLoadProject={handleLoadWithVersioning} />
            </TabsContent>
          </Tabs>
        ) : (
          <div className="space-y-4">
            {/* Toolbar */}
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2 min-w-0">
                  <h2 className="font-semibold text-alfa-black text-base sm:text-lg truncate">
                    {project.title}
                  </h2>
                  {fileName && (
                    <span className="text-[11px] text-alfa-gray font-mono truncate">
                      {fileName}
                    </span>
                  )}
                  {unsavedChanges && (
                    <span className="text-[10px] text-alfa-red font-medium bg-alfa-red/10 px-1.5 py-0.5 rounded">
                      несохранённые изменения
                    </span>
                  )}
                </div>
                {stats && (
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-alfa-gray mt-0.5">
                    <span><strong className="text-alfa-charcoal">{stats.taskCount}</strong> задач</span>
                    <span><strong className="text-alfa-charcoal">{stats.summaryCount}</strong> суммарных</span>
                    <span><strong className="text-alfa-charcoal">{stats.milestoneCount}</strong> вех</span>
                    {stats.criticalCount > 0 && (
                      <span className="text-alfa-red font-medium"><strong>{stats.criticalCount}</strong> критических</span>
                    )}
                    <span className="hidden sm:inline">·</span>
                    <span>{format(project.startDate, "dd.MM.yyyy")} → {format(project.finishDate, "dd.MM.yyyy")}</span>
                  </div>
                )}
              </div>
              {activeTab === "gantt" && (
                <div className="flex items-center gap-1 shrink-0 bg-white border border-alfa-gray-light rounded-lg p-1">
                  <ZoomBtn active={zoom === "day"} onClick={() => setZoom("day")} icon={<ZoomIn className="w-3.5 h-3.5" />} label="Дни" />
                  <ZoomBtn active={zoom === "week"} onClick={() => setZoom("week")} icon={<CalendarRange className="w-3.5 h-3.5" />} label="Недели" />
                  <ZoomBtn active={zoom === "month"} onClick={() => setZoom("month")} icon={<ZoomOut className="w-3.5 h-3.5" />} label="Месяцы" />
                </div>
              )}
            </div>

            {/* Tabs */}
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList>
                <TabsTrigger value="gantt">
                  <BarChart3 className="w-3.5 h-3.5" />
                  Диаграмма
                </TabsTrigger>
                <TabsTrigger value="resources">
                  <Users className="w-3.5 h-3.5" />
                  Ресурсы
                </TabsTrigger>
                <TabsTrigger value="ai">
                  <Sparkles className="w-3.5 h-3.5" />
                  AI-ассистент
                </TabsTrigger>
              </TabsList>

              {/* Gantt tab */}
              <TabsContent value="gantt">
                {/* Legend */}
                <div className="flex items-center gap-4 text-[11px] text-alfa-gray flex-wrap mb-3">
                  <LegendItem color="bg-alfa-red" label="Обычная задача" />
                  <LegendItem color="bg-alfa-red-dark" label="Критическая" />
                  <LegendItem color="bg-alfa-charcoal" label="Суммарная" />
                  <LegendItem diamond="bg-alfa-red" label="Веха" />
                  <LegendItem line="bg-alfa-red" label="Сегодня" />
                  <LegendItem arrow label="Связь Ф→Н/Н→Н/Ф→Ф/Н→Ф" />
                </div>

                {/* Main viewer */}
                <div className="flex rounded-xl overflow-hidden border border-alfa-gray-light bg-white shadow-sm">
                  <div className="flex-1 min-w-0">
                    <GanttChart
                      project={project}
                      zoom={zoom}
                      onTaskClick={setSelected}
                      selectedUid={selected?.uid ?? null}
                    />
                  </div>
                  <TaskDetails
                    task={selected}
                    project={project}
                    onClose={() => setSelected(null)}
                  />
                </div>

                {!selected && (
                  <div className="flex items-center gap-2 text-[12px] text-alfa-gray mt-2">
                    <AlertCircle className="w-3.5 h-3.5" />
                    <span>Кликните по задаче, чтобы увидеть детали и связи.</span>
                  </div>
                )}
              </TabsContent>

              {/* Resources tab */}
              <TabsContent value="resources">
                <ResourceView
                  project={project}
                  vacations={vacations}
                  onVacationsChange={setVacations}
                />
              </TabsContent>

              {/* AI tab */}
              <TabsContent value="ai">
                <AiPanel project={project} onLoadProject={handleLoadWithVersioning} />
              </TabsContent>
            </Tabs>
          </div>
        )}
      </main>
    </div>
  );
}

function computeStats(p: GanttProject) {
  let summaryCount = 0;
  let milestoneCount = 0;
  let criticalCount = 0;
  for (const t of p.tasks) {
    if (t.isSummary) summaryCount++;
    if (t.isMilestone) milestoneCount++;
    if (t.isCritical) criticalCount++;
  }
  return {
    taskCount: p.tasks.length,
    summaryCount,
    milestoneCount,
    criticalCount,
  };
}

function ZoomBtn({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[12px] font-medium transition-colors",
        active ? "bg-alfa-charcoal text-white" : "text-alfa-gray hover:bg-alfa-gray-light",
      )}
    >
      {icon}
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}

function LegendItem({ color, label, diamond, line, arrow }: { color?: string; label: string; diamond?: string; line?: string; arrow?: boolean }) {
  return (
    <div className="flex items-center gap-1.5">
      {color && <div className={cn("w-3 h-2 rounded-sm", color)} />}
      {diamond && <div className={cn("w-2.5 h-2.5 rotate-45", diamond)} />}
      {line && <div className={cn("w-3 h-0.5", line)} style={{ backgroundImage: "repeating-linear-gradient(90deg, currentColor 0 2px, transparent 2px 4px)" }} />}
      {arrow && <div className="w-3 h-px bg-alfa-gray relative after:content-[''] after:absolute after:right-0 after:top-1/2 after:-translate-y-1/2 after:border-l-[4px] after:border-l-alfa-gray after:border-y-[2px] after:border-y-transparent" />}
      <span>{label}</span>
    </div>
  );
}

function Feature({ icon, title, desc }: { icon: React.ReactNode; title: string; desc: string }) {
  return (
    <div className="bg-white border border-alfa-gray-light rounded-lg p-3">
      <div className="w-7 h-7 rounded-md bg-alfa-red/10 text-alfa-red flex items-center justify-center mx-auto mb-1.5">
        {icon}
      </div>
      <div className="text-[12px] font-semibold text-alfa-black">{title}</div>
      <div className="text-[11px] text-alfa-gray mt-0.5">{desc}</div>
    </div>
  );
}
