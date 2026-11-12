# GitHub: подключение на этой машине (handoff для AI-агента)

> Проверено 12.11.2026. Секретов в документе нет — токен живёт в macOS Keychain.

## Учётка и доступ

| Параметр | Значение |
|---|---|
| Аккаунт | `egor-sh` |
| Протокол git | HTTPS (не SSH) |
| gh CLI | `~/.local/bin/gh` (v2.67.0, 44 MB) — **держать именно здесь, не в /tmp** |
| Токен | `gho_…` в macOS Keychain (через `gh auth`), scopes: `repo`, `workflow`, `gist`, `read:org` |
| Credential helper (git global) | `!/Users/egorshakhov/.local/bin/gh auth git-credential` |

## Репозитории проекта gantt-viewer

| Remote | URL | Что это |
|---|---|---|
| `origin` | https://github.com/egor-sh/gantt-viewer.git | **приватный** основной репо |
| `public` | https://github.com/egor-sh/gantt-viewer-public.git | **публичное** зеркало (код очищен от внутренних упоминаний) |

Ветки (приватный): `main` (релизы, сейчас v0.0.15 = `23607a0`, тег `v0.0.15`), `feature/mcp-jira-confluence` (каркас процесса + обвяз), `feature/jira-sync` (законсервирована), `feature/ai-integration`, `public-main` (рабочая ветка зеркала).

## Проверка работоспособности (выполнять первыми)

```bash
export PATH="$HOME/.local/bin:$PATH"
gh auth status          # ожидание: ✓ Logged in to github.com account egor-sh (keyring)
gh api user -q .login   # ожидание: egor-sh
cd ~/ganttviewer/extracted/gantt-viewer && git remote -v
```

## Типовые операции

```bash
# push в приватный
git push origin main

# публикация релиза в зеркало (истории разошлись из-за чистки — только force!)
cd <worktree публичной копии>   # см. Пайплайн ниже
git push public public-main:main --force

# релиз с DMG (297 МБ грузится 10–15 минут; процесс переживает таймауты сессии)
gh release create vX.Y.Z --repo egor-sh/gantt-viewer-public \
  --title "vX.Y.Z — <заголовок>" --notes-file /tmp/relnotes.md <путь>/Gantt-Viewer-X.Y.Z-universal.dmg

# проверить релиз
gh release view vX.Y.Z --repo egor-sh/gantt-viewer-public --json isDraft,assets,url
```

## Пайплайн публикации в публичное зеркало

1. `git worktree add /tmp/gv-pub -b public-main main`
2. Чистка внутренних упоминаний (grep-скан `alfaintra|alfagen|альфа` = 0 совпадений; CSS-токен `bg-alfa-gray` — допустим, это дизайн-палитра)
3. Обновить `CHANGELOG.md`, `README.md`, закоммитить
4. `git push public public-main:main --force`
5. `gh release create` + DMG

## Грабли (уже наступали)

1. **gh в /tmp умирает** — после очистки /tmp credential helper ссылался на несуществующий бинарник, push падал (`could not read Username`). Лечение: скачать gh в `~/.local/bin`, `git config --global --replace-all credential.helper "!$HOME/.local/bin/gh auth git-credential"`. Токен при этом НЕ теряется — он в Keychain.
2. **Keychain-доступ**: первый codesign/credential запрос может требовать разрешения; из nohup/detached-сессий keychain недоступен (сборка с подписью падает на `codesign --sign`). Собирать в присоединённой сессии.
3. **Зеркало = force-push**: приватный и публичный main имеют разную историю (в публичной вычищены внутренние упоминания). Обычный push отклонится.
4. **Токен никогда не печатать в лог/чат** — при необходимости показать наличие: только длина/маска.
