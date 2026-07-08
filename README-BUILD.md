# Просмотрщик диаграмм Ганта — сборка .dmg для macOS

Этот проект — Electron-приложение, оборачивающее статический экспорт Next.js-просмотрщика.
Собирается в `.dmg` на macOS — пользователи скачивают, перетаскивают в Applications и запускают.

## ⚠️ Важно

`.dmg` можно собрать **только на macOS** (Apple Silicon или Intel). На Linux/Windows — никак.
Если у вас нет Mac — попросите знакомого или используйте macOS-раннер на GitHub Actions.

## Что нужно на Mac

1. **macOS 12+** (Monterey или новее)
2. **Node.js 20+** — скачать с https://nodejs.org или установить через `brew install node`
3. **Xcode Command Line Tools** — выполнить в Терминале `xcode-select --install`
4. **~1 ГБ свободного места** (Electron ~150 МБ + кэш npm)

## Шаг 1. Распаковать проект

Дважды кликните по `gantt-viewer.tar.gz` или в Терминале:

```bash
cd ~/Downloads
tar -xzf gantt-viewer.tar.gz
cd gantt-viewer
```

## Шаг 2. Установить зависимости

```bash
npm install
```

Займёт 2–5 минут (скачивается Electron ~150 МБ).

## Шаг 3. Собрать .icns (иконку приложения)

Иконки PNG уже лежат в `build/icon.iconset/`. Соберите `.icns`:

```bash
iconutil -c icns build/icon.iconset -o build/icon.icns
```

Если `iconutil` не найден — установите Xcode Command Line Tools (см. выше).

## Шаг 4. Собрать .dmg

```bash
npm run dist
```

Эта команда:
1. Соберёт статический экспорт Next.js в `out/`
2. Запустит electron-builder
3. Создаст `.dmg` в папке `dist/`

Займёт 3–10 минут в зависимости от Mac.

## Шаг 5. Забрать результат

Готовый файл будет лежать в:

```
dist/Gantt-Viewer-1.0.0-universal.dmg
```

`universal` — работает и на Apple Silicon (M1/M2/M3), и на Intel Mac.

## Проверка

1. Откройте `dist/Gantt-Viewer-1.0.0-universal.dmg` двойным кликом
2. Перетащите **Gantt Viewer** в папку **Applications**
3. Откройте из Launchpad или Applications
4. Нажмите «Открыть демо-проект» — увидите диаграмму Ганта

## Если macOS ругается «приложение от неидентифицированного разработчика»

Это нормально для локально собранных приложений. Два варианта:

**Вариант A** (быстрый):
- Правый клик на Gantt Viewer в Applications → «Открыть» → «Открыть» в диалоге

**Вариант B** (навсегда):
- Системные настройки → Конфиденциальность и безопасность → «Подтвердить вход»

Чтобы этой проблемы не было вообще — нужно подписать приложение сертификатом Apple Developer
($99/год). Для личного использования это не обязательно.

## Доступные скрипты

| Команда | Что делает |
|---------|------------|
| `npm run dev` | Запускает веб-версию на http://localhost:3000 (для разработки) |
| `npm run electron:dev` | Собирает веб и открывает Electron-окно (для теста без .dmg) |
| `npm run dist` | Полная сборка: веб + .dmg |
| `npm run build:dir` | Быстрая сборка без .dmg (для проверки) |
| `npm run lint` | Проверка кода |

## Структура проекта

```
gantt-viewer/
├── electron/              # Electron main process
│   ├── main.js           # Создаёт окно, загружает out/index.html
│   └── preload.js        # Безопасный мост (пока пустой)
├── src/                   # Next.js приложение
│   ├── app/              # App Router (главная страница)
│   ├── components/gantt/ # Компоненты диаграммы Ганта
│   └── lib/              # Парсер MS Project XML
├── build/                # Ресурсы сборки
│   ├── icon.iconset/     # PNG всех размеров (уже готовы)
│   ├── icon.icns         # Соберётся на шаге 3
│   └── entitlements.mac.plist  # Права для запуска
├── out/                   # Статический экспорт (создаётся при сборке)
├── dist/                  # Готовый .dmg (создаётся при сборке)
├── electron-builder.json # Конфигурация electron-builder
├── next.config.ts        # Конфиг Next.js (output: export)
└── package.json
```

## Возможные проблемы

### `iconutil: command not found`
Установите Xcode Command Line Tools: `xcode-select --install`

### `EACCES: permission denied` при npm install
Используйте `sudo npm install --legacy-peer-deps` или настройте npm на использование локальной папки.

### `.dmg` собирается очень долго
Первый раз electron-builder качает Electron-бинарники (~150 МБ). Повторные сборки быстрее.

### Приложение открывается, но пустое окно
Откройте Developer Tools: `Cmd+Option+I`. Скорее всего проблема с путями — проверьте, что `out/index.html` существует.

### Хочу уменьшить размер .dmg
Сейчас сборка ~200 МБ (включает Electron ~150 МБ). Альтернатива — Tauri (Rust, ~5 МБ),
но требует установки Rust toolchain. См. https://tauri.app

## Альтернатива: GitHub Actions (без Mac)

Если Mac недоступен — можно собирать через GitHub Actions:
1. Залейте проект на GitHub
2. Добавьте workflow с `runs-on: macos-latest`
3. CI соберёт `.dmg` автоматически и положит в Releases

Шаблон workflow — в файле `.github/workflows/build-dmg.yml` (если есть).
