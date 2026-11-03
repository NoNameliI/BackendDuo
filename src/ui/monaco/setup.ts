// Monaco is bundled locally (the app works offline) with only the editor features we use
// and the PostgreSQL grammar; no bundled language services.
import 'monaco-editor/features/codeEditor/register';
import 'monaco-editor/features/codicon/register';
import 'monaco-editor/features/bracketMatching/register';
import 'monaco-editor/features/clipboard/register';
import 'monaco-editor/features/comment/register';
import 'monaco-editor/features/contextmenu/register';
import 'monaco-editor/features/cursorUndo/register';
import 'monaco-editor/features/find/register';
import 'monaco-editor/features/hover/register';
import 'monaco-editor/features/linesOperations/register';
import 'monaco-editor/features/multicursor/register';
import 'monaco-editor/features/placeholderText/register';
import 'monaco-editor/features/readOnlyMessage/register';
import 'monaco-editor/features/snippet/register';
import 'monaco-editor/features/suggest/register';
import 'monaco-editor/features/tokenization/register';
import 'monaco-editor/features/wordHighlighter/register';
import 'monaco-editor/features/wordOperations/register';
import 'monaco-editor/editor/browser/coreCommands';
import 'monaco-editor/editor/contrib/find/browser/findController';
import 'monaco-editor/editor/contrib/suggest/browser/suggestController';
import 'monaco-editor/editor/common/standaloneStrings';
import 'monaco-editor/languages/definitions/pgsql/register';
import * as monaco from 'monaco-editor/editor/editor.api';
import EditorWorker from 'monaco-editor/editor/editor.worker?worker';
import { loader } from '@monaco-editor/react';

window.MonacoEnvironment = { getWorker: () => new EditorWorker() };

const syntax = {
  dark: { keyword: '7cc4ff', string: 'f0b86e', number: 'c9a8ff', comment: '6e6d77', predefined: '7fdcc0', muted: 'a3a2ab' },
  light: { keyword: '0a5cb0', string: '9a5200', number: '7036c9', comment: '8a8891', predefined: '0b7a5c', muted: '5a5862' },
};

function rules(c: (typeof syntax)['dark']): monaco.editor.ITokenThemeRule[] {
  return [
    { token: 'keyword', foreground: c.keyword },
    { token: 'operator', foreground: c.muted },
    { token: 'delimiter', foreground: c.muted },
    { token: 'string', foreground: c.string },
    { token: 'number', foreground: c.number },
    { token: 'comment', foreground: c.comment, fontStyle: 'italic' },
    { token: 'predefined', foreground: c.predefined },
  ];
}

monaco.editor.defineTheme('studio-dark', {
  base: 'vs-dark',
  inherit: true,
  rules: rules(syntax.dark),
  colors: {
    'editor.background': '#141417',
    'editor.foreground': '#e8e6e1',
    'editorLineNumber.foreground': '#4a4a53',
    'editorLineNumber.activeForeground': '#a3a2ab',
    'editor.lineHighlightBackground': '#1b1b20',
    'editor.lineHighlightBorder': '#00000000',
    'editor.selectionBackground': '#5cb8ff3d',
    'editorCursor.foreground': '#39f28a',
    'editorWidget.background': '#1f1f24',
    'editorWidget.border': '#3b3b44',
    'editorSuggestWidget.background': '#1f1f24',
    'editorSuggestWidget.border': '#3b3b44',
    'editorSuggestWidget.selectedBackground': '#2c2c34',
    'editorSuggestWidget.highlightForeground': '#5cb8ff',
    'focusBorder': '#5cb8ff',
  },
});

monaco.editor.defineTheme('studio-light', {
  base: 'vs',
  inherit: true,
  rules: rules(syntax.light),
  colors: {
    'editor.background': '#f6f5f1',
    'editor.foreground': '#19191c',
    'editorLineNumber.foreground': '#b3afa5',
    'editorLineNumber.activeForeground': '#514f58',
    'editor.lineHighlightBackground': '#eeece6',
    'editor.lineHighlightBorder': '#00000000',
    'editor.selectionBackground': '#0a64be2e',
    'editorCursor.foreground': '#0a8546',
    'editorWidget.background': '#fbfaf7',
    'editorWidget.border': '#c2beb3',
    'editorSuggestWidget.background': '#fbfaf7',
    'editorSuggestWidget.selectedBackground': '#e6e3dc',
    'editorSuggestWidget.highlightForeground': '#0a64be',
    'focusBorder': '#0a64be',
  },
});

void document.fonts?.ready.then(() => monaco.editor.remeasureFonts());

loader.config({ monaco });

export { monaco };
