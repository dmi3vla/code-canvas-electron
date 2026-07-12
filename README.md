# Code Canvas Desktop

Автономное Electron-приложение, которое объединяет два сценария:

- `Infinite Canvas`-подход: бесконечный канвас, заметки, связи, markdown-текст, сохранение и открытие `.canvas`
- `Code Canvas`-подход: импорт папки проекта, file/code-ноды и автоматические связи по `import` / `require`

## Что уже реализовано

- бесконечный канвас с pan / zoom
- drag & drop перемещение нод
- создание text и code нод
- связи между нодами
- инспектор справа для редактирования выбранной ноды/связи
- сохранение и открытие `.canvas` / `.json`
- импорт папки проекта через системный диалог
- автогенерация file-нод для исходников
- автосвязи по JS / TS / JSX / TSX / MJS / CJS зависимостям
- тёмный desktop UI в стиле code graph

## Что заложено под расширение

- IPC-слой для подключения AI expansion
- совместимый JSON-подход для `.canvas`
- простой entry point для добавления новых типов нод
- отдельный main-process scanner для будущих symbol-level зависимостей

## Быстрый старт

```bash
npm install
npm start
```

## Структура

- `main.js` — Electron main process, диалоги и сканирование проекта
- `preload.js` — безопасный bridge между renderer и Electron API
- `src/index.html` — оболочка интерфейса
- `src/styles.css` — тёмная desktop-стилизация
- `src/app.js` — канвас, рендер нод, связи, сохранение/загрузка

## Следующие логичные шаги

- symbol-level graph для функций / классов
- drag & drop файлов прямо на канвас
- markdown file nodes с редактированием исходного файла
- OpenRouter / локальный LLM для генерации connected ideas
- minimap, поиск и группировка нод
