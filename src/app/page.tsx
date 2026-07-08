'use client';

import { useState, useCallback } from "react";
import { BarChart3, CalendarClock, ZoomIn, ZoomOut, CalendarRange, FileBarChart, Layers, AlertCircle, Users } from "lucide-react";
import { FileUploader, FormatNotice } from "@/components/gantt/file-uploader";
import { GanttChart, type Zoom } from "@/components/gantt/gantt-chart";
import { TaskDetails } from "@/components/gantt/task-details";
import { ResourceView, type Vacation } from "@/components/gantt/resource-view";
import { demoProject, type GanttProject, type GanttTask } from "@/lib/ms-project-parser";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export default function Home() {
  const [project, setProject] = useState<GanttProject | null>(null);
  const [fileName, setFileName] = useState<string>("");
  const [zoom, setZoom] = useState<Zoom>("day");
  const [selected, setSelected] = useState<GanttTask | null>(null);
  const [activeTab, setActiveTab] = useState("gantt");
  const [vacations, setVacations] = useState<Vacation[]>([]);

  const handleLoad = useCallback((p: GanttProject, name: string) => {
    setProject(p);
    setFileName(name);
    setSelected(null);
    setActiveTab("gantt");
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
    toast("Загружен демо-проект");
  }, []);

  const reset = useCallback(() => {
    setProject(null);
    setFileName("");
    setSelected(null);
    setVacations([]);
  }, []);

  const stats = project ? computeStats(project) : null;

  return (
    <div className="min-h-screen flex flex-col bg-slate-50">
      {/* Header — padded left for macOS traffic lights */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-40">
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-4 flex-wrap pl-[80px]">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-lg bg-emerald-600 flex items-center justify-center shrink-0">
              <BarChart3 className="w-5 h-5 text-white" />
            </div>
            <div className="min-w-0">
              <h1 className="font-semibold text-slate-900 text-base sm:text-lg leading-tight truncate">
                Просмотрщик диаграммы Ганта
              </h1>
              <p className="text-[11px] text-slate-500 leading-tight">
                Microsoft Project XML · для macOS
              </p>
            </div>
          </div>
          {project && (
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={loadDemo}>
                <Layers className="w-4 h-4 mr-1.5" />
                Демо
              </Button>
              <Button variant="outline" size="sm" onClick={reset}>
                <FileBarChart className="w-4 h-4 mr-1.5" />
                Другой файл
              </Button>
            </div>
          )}
        </div>
      </header>

      <main className="flex-1 max-w-[1600px] w-full mx-auto px-4 sm:px-6 py-6">
        {!project ? (
          <div className="max-w-2xl mx-auto space-y-6">
            <div className="text-center">
              <h2 className="text-xl sm:text-2xl font-semibold text-slate-900">
                Откройте файл Microsoft Project
              </h2>
              <p className="text-sm text-slate-500 mt-1.5 max-w-md mx-auto">
                Простой просмотрщик файлов <code className="text-slate-700 bg-slate-100 px-1.5 py-0.5 rounded text-[12px]">.xml</code> из MS Project.
                Работает локально — ничего не устанавливается, файлы никуда не отправляются.
              </p>
            </div>

            <FileUploader onLoad={handleLoad} onError={handleError} />

            <FormatNotice />

            <div className="pt-2">
              <Button onClick={loadDemo} variant="default" className="w-full" size="lg">
                <Layers className="w-4 h-4 mr-2" />
                Открыть демо-проект
              </Button>
            </div>

            <div className="grid grid-cols-3 gap-3 pt-4 text-center">
              <Feature icon={<FileBarChart className="w-4 h-4" />} title="XML-формат" desc="Открывается напрямую из MS Project" />
              <Feature icon={<CalendarClock className="w-4 h-4" />} title="Таймлайн" desc="Дни, недели, месяцы" />
              <Feature icon={<Users className="w-4 h-4" />} title="Ресурсы" desc="Загруженность и отпуска" />
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Toolbar */}
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2 min-w-0">
                  <h2 className="font-semibold text-slate-900 text-base sm:text-lg truncate">
                    {project.title}
                  </h2>
                  {fileName && (
                    <span className="text-[11px] text-slate-400 font-mono truncate">
                      {fileName}
                    </span>
                  )}
                </div>
                {stats && (
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-500 mt-0.5">
                    <span><strong className="text-slate-700">{stats.taskCount}</strong> задач</span>
                    <span><strong className="text-slate-700">{stats.summaryCount}</strong> суммарных</span>
                    <span><strong className="text-slate-700">{stats.milestoneCount}</strong> вех</span>
                    {stats.criticalCount > 0 && (
                      <span className="text-rose-600"><strong>{stats.criticalCount}</strong> критических</span>
                    )}
                    <span className="hidden sm:inline">·</span>
                    <span>{format(project.startDate, "dd.MM.yyyy")} → {format(project.finishDate, "dd.MM.yyyy")}</span>
                  </div>
                )}
              </div>
              {activeTab === "gantt" && (
                <div className="flex items-center gap-1 shrink-0 bg-white border border-slate-200 rounded-lg p-1">
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
              </TabsList>

              {/* Gantt tab */}
              <TabsContent value="gantt">
                {/* Legend */}
                <div className="flex items-center gap-4 text-[11px] text-slate-500 flex-wrap mb-3">
                  <LegendItem color="bg-emerald-500" label="Обычная задача" />
                  <LegendItem color="bg-rose-500" label="Критическая" />
                  <LegendItem color="bg-slate-700" label="Суммарная" />
                  <LegendItem diamond="bg-amber-500" label="Веха" />
                  <LegendItem line="bg-rose-500" label="Сегодня" />
                  <LegendItem arrow label="Связь Ф→Н/Н→Н/Ф→Ф/Н→Ф" />
                </div>

                {/* Main viewer */}
                <div className="flex rounded-xl overflow-hidden border border-slate-200 bg-white shadow-sm">
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
                  <div className="flex items-center gap-2 text-[12px] text-slate-500 mt-2">
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
        active ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100",
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
      {arrow && <div className="w-3 h-px bg-slate-400 relative after:content-[''] after:absolute after:right-0 after:top-1/2 after:-translate-y-1/2 after:border-l-[4px] after:border-l-slate-400 after:border-y-[2px] after:border-y-transparent" />}
      <span>{label}</span>
    </div>
  );
}

function Feature({ icon, title, desc }: { icon: React.ReactNode; title: string; desc: string }) {
  return (
    <div className="bg-white border border-slate-200 rounded-lg p-3">
      <div className="w-7 h-7 rounded-md bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto mb-1.5">
        {icon}
      </div>
      <div className="text-[12px] font-semibold text-slate-900">{title}</div>
      <div className="text-[11px] text-slate-500 mt-0.5">{desc}</div>
    </div>
  );
}
