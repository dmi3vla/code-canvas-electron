// src/editor/editor-entry.js
//
// Изолированный компонент "редактор". Не знает про canvas, не знает про
// agent/codemap — только про CodeMirror и про свой узкий контракт:
// mount(container) / openFile(path, content, language, line) / dispose().
//
// Собирается esbuild'ом в один самодостаточный бандл (dist/editor.bundle.js),
// чтобы не тащить бандлер в остальной vanilla-код пустышки.

import { EditorView, basicSetup } from 'codemirror';
import { EditorState, StateEffect, StateField } from '@codemirror/state';
import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { cpp } from '@codemirror/lang-cpp';
import { oneDark } from '@codemirror/theme-one-dark';
import { Decoration } from '@codemirror/view';

// --- anchor (подсветка строки), аналог revealRange+decoration в VSCode ---

const setAnchorEffect = StateEffect.define();

const anchorField = StateField.define({
  create() {
    return Decoration.none;
  },
  update(decorations, tr) {
    decorations = decorations.map(tr.changes);
    for (const effect of tr.effects) {
      if (effect.is(setAnchorEffect)) {
        decorations = effect.value
          ? Decoration.set([
              Decoration.line({ attributes: { class: 'cm-anchor-line' } }).range(effect.value)
            ])
          : Decoration.none;
      }
    }
    return decorations;
  },
  provide: (field) => EditorView.decorations.from(field)
});

const anchorTheme = EditorView.baseTheme({
  '.cm-anchor-line': {
    backgroundColor: 'rgba(90, 160, 255, 0.18)',
    outline: '1px solid rgba(90, 160, 255, 0.55)'
  }
});

// --- выбор языковой поддержки по расширению файла ---

function languageExtensionFor(pathOrLang) {
  const key = String(pathOrLang || '').toLowerCase();
  if (/\.(jsx?|tsx?|mjs|cjs)$/.test(key) || key === 'javascript' || key === 'typescript') {
    return javascript({ jsx: true, typescript: true });
  }
  if (/\.py$/.test(key) || key === 'python') {
    return python();
  }
  if (/\.(c|h|cpp|cc|hpp|cs)$/.test(key) || key === 'cpp' || key === 'c' || key === 'csharp') {
    return cpp();
  }
  // Fallback: без языковой подсветки, но редактор остаётся рабочим —
  // не блокируем открытие файла из-за отсутствия конкретного lang-пакета
  // (go/rust/java добавляются по мере необходимости, список конечен).
  return [];
}

class CodeCanvasEditor {
  constructor() {
    this.view = null;
    this.currentPath = null;
  }

  mount(container) {
    if (this.view) return;
    this.view = new EditorView({
      state: EditorState.create({
        doc: '',
        extensions: [basicSetup, oneDark, anchorField, anchorTheme, EditorView.editable.of(false)]
      }),
      parent: container
    });
  }

  openFile(path, content, line) {
    if (!this.view) throw new Error('CodeCanvasEditor.mount() must be called before openFile()');
    this.currentPath = path;

    const langExt = languageExtensionFor(path);
    const newState = EditorState.create({
      doc: content,
      extensions: [
        basicSetup,
        oneDark,
        anchorField,
        anchorTheme,
        EditorView.editable.of(false),
        langExt
      ]
    });
    this.view.setState(newState);

    if (typeof line === 'number' && line > 0) {
      this.highlightLine(line);
    }
  }

  highlightLine(lineNumber) {
    if (!this.view) return;
    const doc = this.view.state.doc;
    const clamped = Math.min(Math.max(lineNumber, 1), doc.lines);
    const linePos = doc.line(clamped);

    this.view.dispatch({
      effects: [
        setAnchorEffect.of(linePos.from),
        EditorView.scrollIntoView(linePos.from, { y: 'center' })
      ]
    });
  }

  dispose() {
    this.view?.destroy();
    this.view = null;
  }
}

window.CodeCanvasEditor = new CodeCanvasEditor();
