"use client";
export function HelpDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl max-w-lg w-full max-h-[80vh] overflow-y-auto p-5 text-[13px] text-alfa-charcoal" onClick={(e) => e.stopPropagation()}>
        <h2 className="font-bold text-base mb-3">Справка: быстрый старт</h2>
        <div className="space-y-3 leading-relaxed">
          <p><b>1. Конфиг AI.</b> Файл: <code className="bg-alfa-gray-light px-1 rounded font-mono text-[11px]">~/.config/gantt-viewer/ai-config.json</code>. Создаётся автоматически при первом запуске. Откройте и впишите <code className="font-mono text-[11px]">apiKey</code> для нужного провайдера (например, <i>alfagen</i>).</p>
          <p><b>2. Настройки в программе.</b> Кнопка ⚙ в AI-чате: выберите провайдера и модель. Значения синхронизируются с JSON — что вписали в файл, видно в настройках, и наоборот.</p>
          <p><b>3. Новый план.</b> «Другой файл» → откройте .xml из MS Project. Либо вкладка AI → «Генерация»: опишите проект текстом.</p>
          <p><b>4. Редактирование плана.</b> В AI-чате попросите изменить задачи — модель вернёт XML под катом, нажмите «Применить изменения». Перед применением старая версия сохраняется в истории (кнопка «История», до 5 версий).</p>
          <p><b>5. Сохранение.</b> Кнопка «Сохранить» → «Сохранить» (тот же файл) или «Сохранить как…» (новый путь). Путь файла показан под названием проекта.</p>
          <p><b>6. Отпуска из Confluence.</b> Вкладка «Ресурсы» → «Взять из Confluence» (нужен VPN и настроенный MCP в конфиге).</p>
        </div>
        <button onClick={onClose} className="mt-4 px-4 py-1.5 bg-alfa-red text-white rounded-md text-[13px] hover:bg-alfa-red-dark">Понятно</button>
      </div>
    </div>
  );
}
