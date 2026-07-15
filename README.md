# Code Canvas Desktop

Автономное Electron-приложение: **бесконечный канвас** + **семантический GPT-codemap** в стиле Windsurf.

Один продукт — без отдельного VS Code extension / windsurf-subtree.

## Что умеет

### Infinite Canvas
- pan / zoom, drag нод, связи, resize
- text / code / file / **group (area)** ноды
- инспектор, CodeMirror-редактор файла
- сохранение / открытие `.canvas` / `.json`

### Semantic Codemap (Windsurf pipeline)
1. **Research** — агент с tools (`read_file`, `list_dir`, `grep_search`, `find_by_name`)
2. **Structure** — JSON traces + locations (acts)
3. **Per-trace** — дерево связей, file:line decorations, guide
4. **Mermaid** — глобальная flowchart (параллельно), layout areas

### Три проекции одного codemap
| Проекция | UI |
|----------|-----|
| **Canvas** | цветные areas (mermaid subgraphs / traces) + code-ноды + edges |
| **Acts** | левый список traces: clickable tree, guides `[1a]`, locations, Retry |
| **Mermaid** | вкладка live Mermaid (клик по `1a:` → нода на canvas) |

### Кэш в корне проекта
После Generate:
- `.code-canvas.canvas` — layout для UI
- `.code-canvas.codemap.json` — полный codemap (+ `stage12Context` для retry)

Повторное **Открыть проект** грузит кэш **без GPT**.

### Настройки GPT
Общий файл (как у windsurf):

`~/.cometix/codemap/settings.json`

- `openaiApiKey`
- `openaiBaseUrl` (по умолчанию DeepSeek)
- `model`
- `language`

## Быстрый старт

```bash
npm install
npm start
```

Сборка бандлов (editor + mermaid) идёт в `prestart` / `npm run build`.

## Workflow

1. Splash → **Выбрать папку проекта**
2. Settings → API key
3. Query + режим **Smart** / **Fast** → **Generate**
4. Смотреть areas на canvas, acts слева, mermaid-вкладку
5. Suggestions — темы по недавним открытым файлам
6. **Retry trace** / **↻ Mermaid** — без полного research (нужен `stage12Context`)
7. **Import graph** — опциональный structural import/require граф

## Структура репозитория

```
main.js                 Electron main + IPC + project scan
preload.js              contextBridge API
prompts/                stage1–5, mermaid, system, suggestion, fast addon
src/
  agent/                generateCodemap, tools, settings, retries, suggestions
  builder/              codemap → canvas (areas, edges)
  cache/                project-root cache helpers
  editor/               CodeMirror bundle entry
  ui/                   acts-tree.js, mermaid-entry.js
  app.js                canvas shell + UX
  index.html
  styles.css
dist/                   editor.bundle.js, mermaid.bundle.js
```

## IPC (кратко)

| Channel | Назначение |
|---------|------------|
| `project:open` | диалог папки + cache-first load |
| `codemap:generate` | stages 1–6 + write cache |
| `codemap:retryTrace` | stages 3–5 для одного act |
| `codemap:retryMermaid` | stage 6 (context или snapshot) |
| `suggestions:generate` | темы по recent files |
| `settings:*` | GPT settings |

## Режим Smart vs Fast

- **Smart** — system prompt
- **Fast** — + maximize parallel tool calls (быстрее research)

## Удалено из репозитория

- `windsurf-codemap/` — дублирующий extension/standalone (функциональность влита)
- root `codemap-adapter.js` — канон только `src/builder/codemap-adapter.js`

## License

MIT
