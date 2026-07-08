"use client";

import { useState, useEffect } from "react";
import { X, Plus, Trash2, Save, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

/* eslint-disable @typescript-eslint/no-explicit-any */

interface AIConfig {
  activeProvider: string;
  activeModel: string;
  provider: {
    [id: string]: {
      name: string;
      baseURL: string;
      apiKey: string;
      models: { [id: string]: { name: string } };
    };
  };
}

interface AiConfigDialogProps {
  open: boolean;
  onClose: () => void;
}

export function AiConfigDialog({ open, onClose }: AiConfigDialogProps) {
  const [config, setConfig] = useState<AIConfig | null>(null);
  const [configPath, setConfigPath] = useState<string>("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    const ai = (window as any).ai;
    if (!ai) return;
    ai.getConfig().then((c: AIConfig) => {
      setConfig(c);
    });
    ai.getConfigPath().then((p: string) => setConfigPath(p));
  }, [open]);

  if (!open) return null;

  const ai = (window as any).ai;

  const handleProviderField = (
    providerId: string,
    field: "name" | "baseURL" | "apiKey",
    value: string,
  ) => {
    setConfig((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        provider: {
          ...prev.provider,
          [providerId]: {
            ...prev.provider[providerId],
            [field]: value,
          },
        },
      };
    });
  };

  const handleActiveProvider = (id: string) => {
    setConfig((prev) => {
      if (!prev) return prev;
      // pick first model of the new provider as active model
      const provider = prev.provider[id];
      const firstModel = provider?.models
        ? Object.keys(provider.models)[0] || ""
        : "";
      return { ...prev, activeProvider: id, activeModel: firstModel };
    });
  };

  const handleActiveModel = (modelId: string) => {
    setConfig((prev) => (prev ? { ...prev, activeModel: modelId } : prev));
  };

  const handleAddProvider = () => {
    setConfig((prev) => {
      if (!prev) return prev;
      const newId = `custom-${Date.now()}`;
      return {
        ...prev,
        provider: {
          ...prev.provider,
          [newId]: {
            name: "Новый провайдер",
            baseURL: "",
            apiKey: "",
            models: {},
          },
        },
        activeProvider: prev.activeProvider || newId,
      };
    });
  };

  const handleDeleteProvider = (id: string) => {
    setConfig((prev) => {
      if (!prev) return prev;
      const newProviders = { ...prev.provider };
      delete newProviders[id];
      const newActive =
        prev.activeProvider === id
          ? Object.keys(newProviders)[0] || ""
          : prev.activeProvider;
      return {
        ...prev,
        provider: newProviders,
        activeProvider: newActive,
      };
    });
  };

  const handleSave = async () => {
    if (!config) return;
    setSaving(true);
    try {
      await ai.saveConfig(config);
      toast.success("Настройки AI сохранены");
      onClose();
    } catch (e) {
      toast.error("Ошибка сохранения настроек");
    } finally {
      setSaving(false);
    }
  };

  if (!ai) {
    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
        onClick={onClose}
      >
        <div
          className="bg-white rounded-xl shadow-xl max-w-md w-full p-6"
          onClick={(e) => e.stopPropagation()}
        >
          <p className="text-sm text-slate-600">
            AI недоступен. Запустите приложение в Electron.
          </p>
          <Button onClick={onClose} className="mt-4 w-full">
            Закрыть
          </Button>
        </div>
      </div>
    );
  }

  const providerIds = config ? Object.keys(config.provider) : [];
  const activeProviderObj = config?.provider?.[config?.activeProvider || ""];
  const modelIds = activeProviderObj?.models
    ? Object.keys(activeProviderObj.models)
    : [];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-xl max-w-lg w-full my-8 flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
          <h2 className="font-semibold text-slate-900 text-base">
            Настройки AI
          </h2>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-4 overflow-y-auto">
          {/* Config path */}
          {configPath && (
            <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
              <div className="flex items-center gap-1.5 text-[11px] font-medium text-slate-600 mb-1">
                <FileText className="w-3.5 h-3.5" />
                Файл конфигурации
              </div>
              <code className="text-[11px] text-slate-500 break-all font-mono">
                {configPath}
              </code>
              <p className="text-[11px] text-slate-400 mt-1">
                Редактировать напрямую или через эту форму
              </p>
            </div>
          )}

          {!config ? (
            <div className="text-sm text-slate-500 py-8 text-center">
              Загрузка...
            </div>
          ) : (
            <>
              {/* Active provider selector */}
              <div className="space-y-1.5">
                <label className="text-[12px] font-medium text-slate-700">
                  Активный провайдер
                </label>
                <select
                  value={config.activeProvider}
                  onChange={(e) => handleActiveProvider(e.target.value)}
                  className="w-full h-9 rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/30"
                >
                  {providerIds.length === 0 && (
                    <option value="">— нет провайдеров —</option>
                  )}
                  {providerIds.map((id) => (
                    <option key={id} value={id}>
                      {config.provider[id].name || id}
                    </option>
                  ))}
                </select>
              </div>

              {/* Active model selector */}
              {activeProviderObj && modelIds.length > 0 && (
                <div className="space-y-1.5">
                  <label className="text-[12px] font-medium text-slate-700">
                    Модель
                  </label>
                  <select
                    value={config.activeModel}
                    onChange={(e) => handleActiveModel(e.target.value)}
                    className="w-full h-9 rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/30"
                  >
                    {modelIds.map((id) => (
                      <option key={id} value={id}>
                        {activeProviderObj.models[id].name || id}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Provider details (active) */}
              {activeProviderObj && (
                <div className="space-y-3 border-t border-slate-100 pt-3">
                  <div className="text-[12px] font-medium text-slate-700">
                    Параметры: {activeProviderObj.name}
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[11px] text-slate-500">Название</label>
                    <Input
                      value={activeProviderObj.name}
                      onChange={(e) =>
                        handleProviderField(
                          config.activeProvider,
                          "name",
                          e.target.value,
                        )
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[11px] text-slate-500">Base URL</label>
                    <Input
                      value={activeProviderObj.baseURL}
                      onChange={(e) =>
                        handleProviderField(
                          config.activeProvider,
                          "baseURL",
                          e.target.value,
                        )
                      }
                      placeholder="https://api.openai.com/v1"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[11px] text-slate-500">API Key</label>
                    <Input
                      type="password"
                      value={activeProviderObj.apiKey}
                      onChange={(e) =>
                        handleProviderField(
                          config.activeProvider,
                          "apiKey",
                          e.target.value,
                        )
                      }
                      placeholder="sk-..."
                    />
                  </div>
                </div>
              )}

              {/* All providers list with delete */}
              {providerIds.length > 0 && (
                <div className="space-y-1.5 border-t border-slate-100 pt-3">
                  <div className="text-[12px] font-medium text-slate-700">
                    Все провайдеры
                  </div>
                  {providerIds.map((id) => (
                    <div
                      key={id}
                      className="flex items-center justify-between gap-2 px-3 py-2 rounded-md bg-slate-50 border border-slate-100"
                    >
                      <span className="text-[12px] text-slate-700 truncate">
                        {config.provider[id].name || id}
                      </span>
                      <button
                        onClick={() => handleDeleteProvider(id)}
                        className="text-slate-400 hover:text-rose-500 transition-colors shrink-0"
                        title="Удалить провайдера"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Add provider button */}
              <Button
                variant="outline"
                size="sm"
                onClick={handleAddProvider}
                className="w-full"
              >
                <Plus className="w-4 h-4" />
                Добавить провайдера
              </Button>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-slate-200">
          <Button variant="outline" size="sm" onClick={onClose}>
            Отмена
          </Button>
          <Button size="sm" onClick={handleSave} disabled={saving || !config}>
            <Save className="w-4 h-4" />
            {saving ? "Сохранение..." : "Сохранить"}
          </Button>
        </div>
      </div>
    </div>
  );
}
