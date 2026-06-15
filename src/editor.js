/**
 * editor.js — CodeMirror 6 Editor Module for NoteDesk
 * Encapsulates all CM6 setup, theming, and API.
 */

import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection, rectangularSelection } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { syntaxHighlighting, indentOnInput, bracketMatching, foldGutter, foldKeymap, HighlightStyle } from '@codemirror/language';
import { closeBrackets, closeBracketsKeymap, autocompletion } from '@codemirror/autocomplete';
import { oneDark } from '@codemirror/theme-one-dark';
import { tags } from '@lezer/highlight';

// --- Custom NoteDesk Theme ---
// Matches our CSS variables for seamless integration
const noteDeskTheme = EditorView.theme({
  '&': {
    height: '100%',
    fontSize: '14px',
    backgroundColor: 'transparent',
  },
  '.cm-scroller': {
    overflow: 'auto',
    fontFamily: 'var(--editor-font, "Fira Code", monospace)',
    lineHeight: '1.6',
    padding: '8px 0',
  },
  '.cm-content': {
    padding: '20px 30px 20px 10px',
    caretColor: 'var(--accent-color, #7c3aed)',
  },
  '.cm-cursor, .cm-dropCursor': {
    borderLeftColor: 'var(--accent-color, #7c3aed)',
    borderLeftWidth: '2px',
  },
  '.cm-activeLine': {
    backgroundColor: 'rgba(124, 58, 237, 0.06)',
  },
  '.cm-activeLineGutter': {
    backgroundColor: 'rgba(124, 58, 237, 0.08)',
    color: 'var(--accent-color, #7c3aed)',
  },
  '.cm-gutters': {
    backgroundColor: 'var(--bg-secondary, #161616)',
    color: 'var(--text-faint, #555)',
    border: 'none',
    paddingLeft: '8px',
  },
  '.cm-lineNumbers .cm-gutterElement': {
    padding: '0 8px 0 4px',
    minWidth: '32px',
    fontSize: '12px',
  },
  '.cm-foldGutter .cm-gutterElement': {
    padding: '0 4px',
    cursor: 'pointer',
    color: 'var(--text-faint, #555)',
    transition: 'color 0.15s ease',
  },
  '.cm-foldGutter .cm-gutterElement:hover': {
    color: 'var(--accent-color, #7c3aed)',
  },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': {
    backgroundColor: 'rgba(124, 58, 237, 0.20) !important',
  },
  '.cm-selectionMatch': {
    backgroundColor: 'rgba(124, 58, 237, 0.12)',
  },
  '&.cm-focused': {
    outline: 'none',
  },
  '.cm-matchingBracket': {
    backgroundColor: 'rgba(124, 58, 237, 0.25)',
    outline: '1px solid rgba(124, 58, 237, 0.4)',
  },
  '.cm-tooltip': {
    backgroundColor: 'var(--bg-tertiary, #202020)',
    border: '1px solid var(--border-color, #2e2e2e)',
    color: 'var(--text-normal, #dcdcdc)',
  },
  '.cm-tooltip-autocomplete': {
    backgroundColor: 'var(--bg-secondary, #161616) !important',
    border: '1px solid var(--border-color, #2e2e2e) !important',
    borderRadius: 'var(--radius-md, 6px) !important',
    boxShadow: '0 8px 24px rgba(0, 0, 0, 0.5) !important',
    padding: '4px !important',
  },
  '.cm-completionList': {
    fontFamily: 'var(--font-ui) !important',
    fontSize: '13px !important',
    maxHeight: '200px !important',
  },
  '.cm-completionList li': {
    borderRadius: 'var(--radius-sm, 4px) !important',
    padding: '6px 10px !important',
    display: 'flex !important',
    alignItems: 'center !important',
    gap: '8px !important',
    color: 'var(--text-muted, #a0a0a0) !important',
  },
  '.cm-completionList li[aria-selected]': {
    backgroundColor: 'var(--bg-active, #2b2b2b) !important',
    color: 'var(--text-normal, #ffffff) !important',
  },
  '.cm-completionDetail': {
    fontStyle: 'italic !important',
    opacity: '0.6 !important',
    fontSize: '11px !important',
    marginLeft: 'auto !important',
  },
  '.cm-completionIcon': {
    opacity: '0.8 !important',
  },
}, { dark: true });

// --- Custom Markdown Syntax Highlighting ---
const noteDeskHighlighting = HighlightStyle.define([
  // Headings — gradient of accent tones
  { tag: tags.heading1, color: '#c084fc', fontWeight: '700', fontSize: '1.6em' },
  { tag: tags.heading2, color: '#a78bfa', fontWeight: '600', fontSize: '1.4em' },
  { tag: tags.heading3, color: '#8b5cf6', fontWeight: '600', fontSize: '1.2em' },
  { tag: tags.heading4, color: '#7c3aed', fontWeight: '500' },
  { tag: tags.heading5, color: '#6d28d9', fontWeight: '500' },
  { tag: tags.heading6, color: '#5b21b6', fontWeight: '500' },

  // Emphasis
  { tag: tags.emphasis, color: '#e879f9', fontStyle: 'italic' },
  { tag: tags.strong, color: '#f0abfc', fontWeight: '700' },
  { tag: tags.strikethrough, color: '#888', textDecoration: 'line-through' },

  // Links
  { tag: tags.link, color: '#60a5fa', textDecoration: 'underline' },
  { tag: tags.url, color: '#818cf8' },

  // Code
  { tag: tags.monospace, color: '#34d399', fontFamily: 'var(--editor-font, "Fira Code", monospace)' },

  // Quotes
  { tag: tags.quote, color: '#a5b4fc', fontStyle: 'italic' },

  // Lists
  { tag: tags.list, color: '#fbbf24' },

  // Meta / special Markdown chars (##, **, etc.)
  { tag: tags.meta, color: '#6b7280' },
  { tag: tags.processingInstruction, color: '#6b7280' },

  // Comments
  { tag: tags.comment, color: '#4b5563', fontStyle: 'italic' },

  // Literals, numbers
  { tag: tags.number, color: '#f472b6' },
  { tag: tags.string, color: '#34d399' },
  { tag: tags.bool, color: '#fb923c' },

  // Keywords, operators (for embedded code blocks)
  { tag: tags.keyword, color: '#c084fc' },
  { tag: tags.operator, color: '#94a3b8' },
  { tag: tags.definitionKeyword, color: '#a78bfa' },
  { tag: tags.typeName, color: '#38bdf8' },
  { tag: tags.function(tags.variableName), color: '#60a5fa' },
  { tag: tags.propertyName, color: '#34d399' },
]);

// --- Helper for toggling Bold/Italic format ---
function toggleFormat(view, marker) {
  const { state } = view;
  const { main } = state.selection;
  const len = marker.length;

  if (!main.empty) {
    const selectedText = state.sliceDoc(main.from, main.to);
    // If already wrapped with the marker, unwrap it
    if (selectedText.startsWith(marker) && selectedText.endsWith(marker)) {
      view.dispatch({
        changes: [
          { from: main.from, to: main.from + len, insert: '' },
          { from: main.to - len, to: main.to, insert: '' }
        ],
        selection: { anchor: main.from, head: main.to - (len * 2) }
      });
    } else {
      // Wrap it
      view.dispatch({
        changes: [
          { from: main.from, insert: marker },
          { from: main.to, insert: marker }
        ],
        selection: { anchor: main.from + len, head: main.to + len }
      });
    }
  } else {
    // Empty selection: insert the double marker and place cursor in the middle
    view.dispatch({
      changes: { from: main.head, insert: marker + marker },
      selection: { anchor: main.head + len }
    });
  }
  return true;
}

// --- Formatting Keyboard Shortcuts (Ctrl+B / Ctrl+I) ---
const formattingKeymap = keymap.of([
  {
    key: 'Mod-b',
    run: (view) => toggleFormat(view, '**')
  },
  {
    key: 'Mod-i',
    run: (view) => toggleFormat(view, '*')
  }
]);

// --- Smart Asterisk Input Handler ---
// 1. Type '*' on selection -> wraps selection
// 2. Type '*' at empty cursor -> auto-closes to '*|*'
// 3. Type '*' inside '*|*' -> completes to '**|**'
// 4. Type '*' inside '**|**' -> skips closing '*'
const asteriskInputHandler = EditorView.inputHandler.of((view, from, to, text) => {
  if (text !== '*') return false;

  const { state } = view;
  const { main } = state.selection;

  // Wrap selection with '*'
  if (!main.empty) {
    view.dispatch({
      changes: [
        { from: main.from, insert: '*' },
        { from: main.to, insert: '*' }
      ],
      selection: { anchor: main.from + 1, head: main.to + 1 }
    });
    return true;
  }

  // Single cursor behavior
  const pos = main.head;
  const charBefore = state.sliceDoc(pos - 1, pos);
  const twoBefore = state.sliceDoc(pos - 2, pos);
  const charAfter = state.sliceDoc(pos, pos + 1);

  if (charBefore === '*' && charAfter === '*' && twoBefore !== '**') {
    // We are at *|* -> complete to bold **|**
    view.dispatch({
      changes: [
        { from: pos, insert: '*' },
        { from: pos + 1, insert: '*' }
      ],
      selection: { anchor: pos + 1 }
    });
    return true;
  } else if (charAfter === '*') {
    // Skip over the next closing '*'
    view.dispatch({
      selection: { anchor: pos + 1 }
    });
    return true;
  } else {
    // First asterisk: auto-close if allowed characters follow
    const allowedChars = " \t\r\n)]}.,;:!?_-*\"'`";
    const isAllowedAfter = !charAfter || allowedChars.includes(charAfter);
    if (isAllowedAfter) {
      view.dispatch({
        changes: { from: pos, insert: '**' },
        selection: { anchor: pos + 1 }
      });
      return true;
    }
  }

  return false;
});

// --- Smart Backspace Handler for Formatting ---
// 1. Backspace at **|** -> deletes bold outer markers leaving *|*
// 2. Backspace at *|* -> deletes italic outer markers leaving |
const asteriskKeymap = keymap.of([
  {
    key: 'Backspace',
    run: (view) => {
      const { state } = view;
      const { main } = state.selection;
      if (!main.empty) return false;

      const pos = main.head;
      const charBefore = state.sliceDoc(pos - 1, pos);
      const charAfter = state.sliceDoc(pos, pos + 1);
      const twoBefore = state.sliceDoc(pos - 2, pos);
      const twoAfter = state.sliceDoc(pos, pos + 2);

      if (twoBefore === '**' && twoAfter === '**') {
        // **|** -> *|*
        view.dispatch({
          changes: [
            { from: pos - 1, to: pos },
            { from: pos, to: pos + 1 }
          ],
          selection: { anchor: pos - 1 }
        });
        return true;
      } else if (charBefore === '*' && charAfter === '*') {
        // *|* -> |
        view.dispatch({
          changes: [
            { from: pos - 1, to: pos },
            { from: pos, to: pos + 1 }
          ],
          selection: { anchor: pos - 1 }
        });
        return true;
      }
      return false;
    }
  }
]);



/**
 * Creates a new CodeMirror 6 editor instance.
 * @param {HTMLElement} parentElement — DOM element to mount the editor into.
 * @param {Object} options
 * @param {Function} options.onChange — Callback invoked with (content: string) on every document change.
 * @param {Function} options.getNoteNames — Callback that returns an array of existing note names.
 * @param {Function} options.onCreateNote — Callback invoked when a new note should be created in the background.
 * @returns {EditorView} — The CM6 EditorView instance.
 */
export function createEditor(parentElement, { onChange, getNoteNames, onCreateNote } = {}) {
  const updateListener = EditorView.updateListener.of((update) => {
    if (update.docChanged && onChange) {
      const content = update.state.doc.toString();
      onChange(content);
    }
  });

  const state = EditorState.create({
    doc: '',
    extensions: [
      // Core editing
      history(),
      drawSelection(),
      rectangularSelection(),
      indentOnInput(),
      bracketMatching(),
      closeBrackets(),

      // Custom Wikilinks Autocompletion
      autocompletion({
        override: [
          (context) => {
            const before = context.matchBefore(/\[\[([^\]]*)$/);
            if (!before) return null;

            const query = before.text.slice(2);
            const noteNames = getNoteNames ? getNoteNames() : [];

            // Map existing notes
            const options = noteNames
              .filter(name => name.toLowerCase().includes(query.toLowerCase()))
              .map(name => ({
                label: name,
                type: "file",
                detail: "Nota existente",
                apply: (view, completion, from, to) => {
                  const insertText = name + "]]";
                  const afterCursor = view.state.sliceDoc(to, to + 2);
                  let replaceTo = to;
                  if (afterCursor === "]]") {
                    replaceTo = to + 2;
                  } else if (afterCursor.startsWith("]")) {
                    replaceTo = to + 1;
                  }
                  view.dispatch({
                    changes: { from, to: replaceTo, insert: insertText }
                  });
                }
              }));

            // Offer creation if query is not empty and not an exact match
            const exactMatch = noteNames.some(name => name.toLowerCase() === query.toLowerCase());
            if (!exactMatch && query.trim().length > 0) {
              const nameToCreate = query.trim();
              options.push({
                label: `✨ Crear nueva página "${nameToCreate}"`,
                type: "action",
                detail: "Nueva nota",
                apply: (view, completion, from, to) => {
                  const insertText = nameToCreate + "]]";
                  const afterCursor = view.state.sliceDoc(to, to + 2);
                  let replaceTo = to;
                  if (afterCursor === "]]") {
                    replaceTo = to + 2;
                  } else if (afterCursor.startsWith("]")) {
                    replaceTo = to + 1;
                  }
                  view.dispatch({
                    changes: { from, to: replaceTo, insert: insertText }
                  });
                  if (onCreateNote) {
                    onCreateNote(nameToCreate);
                  }
                }
              });
            }

            return {
              from: before.from + 2,
              options
            };
          }
        ]
      }),

      // Custom Markdown formatting handlers
      asteriskInputHandler,
      asteriskKeymap,
      formattingKeymap,

      // Line numbers and fold
      lineNumbers(),
      highlightActiveLine(),
      highlightActiveLineGutter(),
      foldGutter(),

      // Language: Markdown with embedded code block support
      markdown({
        base: markdownLanguage,
        codeLanguages: languages,
      }),

      // Keymaps
      keymap.of([
        ...closeBracketsKeymap,
        ...defaultKeymap,
        ...historyKeymap,
        ...foldKeymap,
        indentWithTab,
      ]),

      // Theming
      oneDark,
      noteDeskTheme,
      syntaxHighlighting(noteDeskHighlighting),

      // Change listener
      updateListener,



      // Tab size
      EditorState.tabSize.of(4),

      // Wrap long lines
      EditorView.lineWrapping,
    ],
  });

  const view = new EditorView({
    state,
    parent: parentElement,
  });

  return view;
}

/**
 * Get the full text content from the editor.
 * @param {EditorView} view
 * @returns {string}
 */
export function getContent(view) {
  return view.state.doc.toString();
}

/**
 * Replace the entire editor content with new text.
 * Used when opening a different note.
 * @param {EditorView} view
 * @param {string} text
 */
export function setContent(view, text) {
  view.dispatch({
    changes: {
      from: 0,
      to: view.state.doc.length,
      insert: text,
    },
  });
}

/**
 * Focus the editor.
 * @param {EditorView} view
 */
export function focusEditor(view) {
  view.focus();
}

/**
 * Scroll the editor to a specific line number.
 * @param {EditorView} view
 * @param {number} lineNum
 */
export function scrollToLine(view, lineNum) {
  try {
    const line = view.state.doc.line(lineNum);
    view.dispatch({
      effects: EditorView.scrollIntoView(line.from, { y: 'start' }),
      selection: { anchor: line.from }
    });
    view.focus();
  } catch (err) {
    console.error('Error scrolling to line:', lineNum, err);
  }
}

