# Code Canvas Electron — план UI-композиции (для исполняющего агента)

## Контекст: что уже сделано и проверено (не переделывать)

- `src/editor/editor-entry.js` — CodeMirror-панель, собирается `npm run build:editor` (esbuild → `dist/editor.bundle.js`), открывается по кнопке в инспекторе, умеет `openFile(path, content, line)` + `highlightLine` (anchor).
- `src/builder/codemap-adapter.js` — конвертирует codemap (traces/locations/mermaidDiagram) в `.canvas` (nodes/edges), извлекает межтрейсовые связи регэкспом, группирует в area по mermaid-subgraphs.
- `src/agent/*.js` — портированный агент (baseClient, codemapAgent, prompts, settings, tools, utils), без vscode-зависимостей.
- `src/cache/project-cache.js` — кэш codemap, `.code-canvas.*` в `.gitignore`.
- `main.js`: `resolveReadPath()` — валидированное чтение файлов (path traversal закрыт и проверен тестами).
- Текущий layout: `left-sidebar` (режим) + `canvas-stage` (canvas-root + editor-panel оверлеем) + `right-sidebar` (инспектор).

Эта фаза **не трогает** agent/adapter/cache-логику — только shell/UI. Три независимых, последовательно выполняемых этапа.

---

## Фаза A — Top-menu (заменяет left/right sidebar)

**Файлы:** `src/index.html`, `src/app.js`, `src/styles.css`

### A.1 — Разметка
Добавить `<header id="top-menu" class="top-menu">` перед `main-layout` в `src/index.html`. Секции: логотип/название проекта, `Файл` (New/Open/Save canvas — переиспользовать существующие `buttons.newCanvas` и связанные обработчики), `Импорт` (текущая кнопка импорта папки), `Режим` (то, что сейчас в left-sidebar), `Regenerate codemap` (вызов агента).

### A.2 — Инспектор → поповер
Убрать `<aside id="right-sidebar">` из постоянного layout. При выборе ноды (`state.selection.type === 'node'`) показывать компактный поповер, позиционированный у экранных координат ноды (`getBoundingClientRect()` элемента ноды + смещение), содержащий те же поля, что сейчас в `inspector-node` (title/type/subtitle/content, кнопка "Открыть в редакторе"). Закрытие — клик вне поповера или Escape.

### A.3 — Удаление старого layout
Убрать `left-sidebar`/`right-sidebar` и связанные rail-кнопки (`sidebar-rail-left/right`) из HTML и CSS. Не оставлять мёртвый CSS.

**Критерий готовности:** `npm start` — нет боковых панелей, все прежние действия (новый canvas, импорт, режим) доступны из top-menu, клик по ноде показывает поповер вместо постоянной правой панели, `open-in-editor-btn` внутри поповера работает как раньше.

---

## Фаза B — Zoom-to-area (декомпозиция узла на холсте)

**Файлы:** новый `src/canvas/zoom-to-area.js`, правки в `src/app.js`

### B.1 — Вычисление bounds области
Функция `computeAreaBounds(areaId, nodes)` — по всем нодам с `node.areaId === areaId` считает bounding box (min/max x/y с учётом width/height).

### B.2 — Fit-to-viewport трансформация
Функция `fitViewportToBounds(bounds, viewportSize, padding=40)` — возвращает `{x, y, scale}` для `state.viewport`, вписывающий bounds в видимую область canvas-stage с отступом.

### B.3 — Анимация перехода
`animateViewport(fromViewport, toViewport, duration=300)` — rAF-цикл с ease-out интерполяцией x/y/scale, на каждом кадре обновляет `state.viewport` и вызывает существующую функцию перерисовки трансформа канваса (найти, как сейчас применяется `state.viewport` к `canvas-content`/`edges-layer` — переиспользовать тот же метод, не дублировать).

### B.4 — Триггер и breadcrumb
Клик по area (не по отдельной ноде — по фоновой зоне группы/её заголовку) → `zoomToArea(areaId)`. Одновременно рендерится breadcrumb-оверлей (`Проект > <area.title>`) поверх canvas-root, стиль — как в приложенном мокапе (компактная пилюля в левом верхнем углу). Клик по "Проект" в breadcrumb → зум назад к `fitViewportToBounds(fullCanvasBounds)`.

**Критерий готовности:** клик по area с 5+ нодами — плавный зум (не мгновенный скачок) до заполнения экрана этой областью, breadcrumb появляется и корректно возвращает на исходный масштаб.

---

## Фаза C — Chat-панель

**Файлы:** новый `src/chat/chat-entry.js` (или расширение существующего `editor-entry.js` подхода — отдельный esbuild-бандл), правки в `src/index.html`, `src/app.js`, `main.js`/`preload.js` (IPC для стриминга ответов агента)

### C.1 — Разметка дока
В `editor-panel` (существующий оверлей) добавить вертикальное разделение: верхняя часть (~60%) — текущий `editor-panel-mount`, нижняя (~40%) — новый `chat-panel-mount`, между ними — resizable-разделитель (переиспользовать паттерн, если такой уже есть у node-resize-handle в `app.js`, иначе — простой drag на mousedown/mousemove).

### C.2 — IPC для чата
В `main.js`: `ipcMain.handle('agent:chatMessage', async (_, message, context) => {...})` — вызывает существующий `codemapAgent` (не создавать второй экземпляр агента) с сообщением пользователя + опциональным контекстом (id выбранной ноды/trace, если чат открыт в контексте конкретного узла). В `preload.js` — expose `window.electronAPI.sendChatMessage(message, context)`.

### C.3 — Рендер чата
`chat-entry.js` — простой список сообщений (user/assistant), textarea + кнопка отправки, вызывает `electronAPI.sendChatMessage`. Стриминг ответа — если `codemapAgent` уже поддерживает streaming (использовался в "Stream area layout during generate" судя по истории коммитов) — переиспользовать тот же паттерн событий, не изобретать новый.

### C.4 — Контекстная привязка
Если чат открыт при выбранной ноде — первое сообщение агенту включает контекст этой ноды (path/title/trace), чтобы можно было спросить "объясни эту ноду" без ручного объяснения контекста.

**Критерий готовности:** сообщение в чат → реальный ответ от того же агента, что генерирует codemap (не заглушка), в контексте открытой ноды агент знает, о какой ноде речь.

---

## Порядок выполнения

**A → B → C.** Top-menu первым — освобождает layout под чат-панель Фазы C и снимает конфликт с существующим right-sidebar до того, как туда же добавляется чат. Zoom-decomposition (B) не зависит от A/C и может выполняться параллельно, если ведёт другой агент/поток работы — единственная точка пересечения с C: обе трогают `canvas-stage`, но в разных файлах (`zoom-to-area.js` не касается `editor-panel`).

## Что не входит в этот план (сознательно)

- Промт-инжиниринг для чата (системный промпт агента для разговорного режима, не codemap-генерации) — отдельная задача, не архитектурная.
- Мобильная/адаптивная раскладка — приложение desktop-only (Electron), не рассматривается.
