/**
 * editor.js — CodeMirror 6 Editor Module for NoteDesk
 * Encapsulates all CM6 setup, theming, and API.
 */

import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection, rectangularSelection, Decoration, ViewPlugin } from '@codemirror/view';
import { EditorState, RangeSetBuilder, Prec } from '@codemirror/state';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { markdown, markdownLanguage, markdownKeymap } from '@codemirror/lang-markdown';
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
    lineHeight: 'var(--editor-line-height, 1.3)',
    padding: '8px 0',
  },
  '.cm-content': {
    padding: '20px 30px 20px 10px',
    caretColor: 'var(--accent-color, #7c3aed)',
    color: 'var(--editor-heading-color, inherit)',
  },
  '.cm-cursor, .cm-dropCursor': {
    borderLeftColor: 'var(--accent-color, #7c3aed)',
    borderLeftWidth: '2px',
  },
  '.cm-activeLine': {
    backgroundColor: 'rgba(var(--accent-color-rgb, 124, 58, 237), 0.06)',
  },
  '.cm-activeLineGutter': {
    backgroundColor: 'rgba(var(--accent-color-rgb, 124, 58, 237), 0.08)',
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
    backgroundColor: 'rgba(var(--accent-color-rgb, 124, 58, 237), 0.20) !important',
  },
  '.cm-selectionMatch': {
    backgroundColor: 'rgba(var(--accent-color-rgb, 124, 58, 237), 0.12)',
  },
  '&.cm-focused': {
    outline: 'none',
  },
  '.cm-matchingBracket': {
    backgroundColor: 'rgba(var(--accent-color-rgb, 124, 58, 237), 0.25)',
    outline: '1px solid rgba(var(--accent-color-rgb, 124, 58, 237), 0.4)',
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
  { tag: tags.heading1, color: 'var(--editor-heading-color, #c084fc)', fontWeight: '700', fontSize: '1.6em' },
  { tag: tags.heading2, color: 'var(--editor-heading-color, #a78bfa)', fontWeight: '600', fontSize: '1.4em' },
  { tag: tags.heading3, color: 'var(--editor-heading-color, #8b5cf6)', fontWeight: '600', fontSize: '1.2em' },
  { tag: tags.heading4, color: 'var(--editor-heading-color, #7c3aed)', fontWeight: '500' },
  { tag: tags.heading5, color: 'var(--editor-heading-color, #6d28d9)', fontWeight: '500' },
  { tag: tags.heading6, color: 'var(--editor-heading-color, #5b21b6)', fontWeight: '500' },

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
  { tag: tags.processingInstruction, color: 'var(--editor-mark-color, #34d399)' },

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


// --- Live Preview Markdown Extension ---
// Hides Markdown markers (#, **, *, __, _, [[, ]], >) on inactive lines (without cursor)
// to make the editor look like a live preview, showing raw markdown syntax only when active.
const markdownLivePreview = ViewPlugin.fromClass(class {
  constructor(view) {
    this.decorations = this.getDecorations(view);
  }

  update(update) {
    if (update.docChanged || update.selectionSet || update.viewportChanged) {
      this.decorations = this.getDecorations(update.view);
    }
  }

  getDecorations(view) {
    const state = view.state;
    const allDecos = [];
    
    // Get all line numbers that intersect with the current cursor/selections
    const activeLines = new Set();
    for (const range of state.selection.ranges) {
      const startLine = state.doc.lineAt(range.from).number;
      const endLine = state.doc.lineAt(range.to).number;
      for (let l = startLine; l <= endLine; l++) {
        activeLines.add(l);
      }
    }

    // Process visible ranges in the viewport
    for (const { from, to } of view.visibleRanges) {
      let pos = from;
      while (pos < to) {
        const line = state.doc.lineAt(pos);
        const lineText = line.text;
        const lineStart = line.from;
        const isLineActive = activeLines.has(line.number);

        // Draw indentation guide lines for list items (LogSeq style)
        const spaceMatch = lineText.match(/^([ \t]+)-\s/);
        if (spaceMatch) {
          const spaces = spaceMatch[1].replace(/\t/g, '    ');
          const numSteps = Math.floor(spaces.length / 4);
          for (let i = 0; i < numSteps; i++) {
            let colCount = 0;
            let charIdx = 0;
            while (charIdx < lineText.length && colCount < i * 4) {
              if (lineText[charIdx] === '\t') {
                colCount += 4;
              } else {
                colCount += 1;
              }
              charIdx++;
            }
            if (colCount === i * 4 && charIdx < lineText.length) {
              allDecos.push({
                from: lineStart + charIdx,
                to: lineStart + charIdx + 1,
                value: Decoration.mark({ class: `cm-indent-guide cm-indent-guide-${i + 1}` })
              });
            }
          }
        }
        
        if (!isLineActive) {
          const covered = new Array(lineText.length).fill(false);

          // Helper to add decoration if not already covered by another match
          const addDeco = (start, end, val) => {
            if (start >= end) return;
            // Check if covered
            for (let i = start; i < end; i++) {
              if (covered[i]) return;
            }
            // Mark as covered
            for (let i = start; i < end; i++) {
              covered[i] = true;
            }
            allDecos.push({
              from: lineStart + start,
              to: lineStart + end,
              value: val
            });
          };

          // 1. Match LogSeq Bullet Marker: "- " (with optional indentation)
          const bulletMatch = lineText.match(/^([ \t]*)(-\s)/);
          if (bulletMatch) {
            const spacesLen = bulletMatch[1].length;
            // Hide the hyphen '-'
            addDeco(spacesLen, spacesLen + 1, Decoration.mark({ class: 'cm-formatting-hidden' }));
            // Style the space ' ' as the bullet placeholder
            addDeco(spacesLen + 1, spacesLen + 2, Decoration.mark({ class: 'cm-list-bullet' }));
          }

          // 2. Match Wikilinks: [[Note]] or [[Note|Label]]
          const wikiRegex = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;
          let match;
          while ((match = wikiRegex.exec(lineText)) !== null) {
            const matchIndex = match.index;
            const matchLen = match[0].length;
            const notePart = match[1];
            const labelPart = match[2];
            
            if (labelPart !== undefined) {
              addDeco(matchIndex, matchIndex + 2 + notePart.length + 1, Decoration.mark({ class: 'cm-formatting-hidden' }));
              addDeco(matchIndex + 2 + notePart.length + 1, matchIndex + matchLen - 2, Decoration.mark({ class: 'cm-wikilink-preview' }));
              addDeco(matchIndex + matchLen - 2, matchIndex + matchLen, Decoration.mark({ class: 'cm-formatting-hidden' }));
            } else {
              addDeco(matchIndex, matchIndex + 2, Decoration.mark({ class: 'cm-formatting-hidden' }));
              addDeco(matchIndex + 2, matchIndex + matchLen - 2, Decoration.mark({ class: 'cm-wikilink-preview' }));
              addDeco(matchIndex + matchLen - 2, matchIndex + matchLen, Decoration.mark({ class: 'cm-formatting-hidden' }));
            }
          }

          // 3. Match Headers: e.g., "# " after bullet prefix
          const headerMatch = lineText.match(/^([ \t]*-\s+)(#{1,6}\s)/);
          if (headerMatch) {
            const prefixLen = headerMatch[1].length;
            const hashesLen = headerMatch[2].length - 1; // Exclude space
            addDeco(prefixLen, prefixLen + hashesLen, Decoration.mark({ class: 'cm-formatting-hidden' }));
          } else {
            // Also fallback match headers without bullet (just in case)
            const headerMatchPlain = lineText.match(/^(#{1,6}\s)/);
            if (headerMatchPlain) {
              const hashesLen = headerMatchPlain[1].length - 1;
              addDeco(0, hashesLen, Decoration.mark({ class: 'cm-formatting-hidden' }));
            }
          }

          // 4. Match Bold and Italic: **, *, __, _
          const formatRegex = /(\*\*|\*|__|_)/g;
          let fmtMatch;
          while ((fmtMatch = formatRegex.exec(lineText)) !== null) {
            const start = fmtMatch.index;
            const end = start + fmtMatch[0].length;
            addDeco(start, end, Decoration.mark({ class: 'cm-formatting-hidden' }));
          }

          // 5. Match Blockquotes: e.g., "> " after bullet prefix or at start
          const quoteMatch = lineText.match(/^([ \t]*-\s+)?(>\s*)/);
          if (quoteMatch) {
            const prefixLen = quoteMatch[1] ? quoteMatch[1].length : 0;
            const markerIndex = quoteMatch[2].indexOf('>');
            if (markerIndex !== -1) {
              addDeco(prefixLen + markerIndex, prefixLen + markerIndex + 1, Decoration.mark({ class: 'cm-formatting-hidden' }));
            }
          }
        }
        
        pos = line.to + 1;
      }
    }

    // Sort disjoint decorations sequentially
    allDecos.sort((a, b) => a.from - b.from);
    
    // Build RangeSet
    const builder = new RangeSetBuilder();
    for (const deco of allDecos) {
      builder.add(deco.from, deco.to, deco.value);
    }
    return builder.finish();
  }
}, {
  decorations: v => v.decorations
});

// --- Custom Indentation Commands for Lists (LogSeq Style) ---
function indentListCommand(view) {
  const { state } = view;
  let changes = [];
  const processedLines = new Set();
  
  for (const range of state.selection.ranges) {
    const startLine = state.doc.lineAt(range.from).number;
    const endLine = state.doc.lineAt(range.to).number;
    for (let l = startLine; l <= endLine; l++) {
      if (processedLines.has(l)) continue;
      processedLines.add(l);
    }
  }

  for (const lineNum of processedLines) {
    const line = state.doc.line(lineNum);
    const trimmed = line.text.trim();
    if (!trimmed) {
      // If line is empty, turn it into an indented bullet
      const spaceMatch = line.text.match(/^([ \t]*)/);
      const spaces = spaceMatch ? spaceMatch[1] : '';
      changes.push({
        from: line.from,
        to: line.to,
        insert: spaces + '    - '
      });
    } else if (!/^\s*([-*+]|\d+\.)\s/.test(line.text)) {
      // If no bullet, prepend and indent
      const spaceMatch = line.text.match(/^([ \t]*)/);
      const spaces = spaceMatch ? spaceMatch[1] : '';
      const content = line.text.slice(spaces.length);
      changes.push({
        from: line.from,
        to: line.to,
        insert: spaces + '    - ' + content
      });
    } else {
      // Already a list item, just indent 4 spaces
      changes.push({
        from: line.from,
        insert: '    '
      });
    }
  }

  view.dispatch({
    changes
  });
  return true;
}

function outdentListCommand(view) {
  const { state } = view;
  let changes = [];
  const processedLines = new Set();

  for (const range of state.selection.ranges) {
    const startLine = state.doc.lineAt(range.from).number;
    const endLine = state.doc.lineAt(range.to).number;
    for (let l = startLine; l <= endLine; l++) {
      if (processedLines.has(l)) continue;
      processedLines.add(l);
    }
  }

  for (const lineNum of processedLines) {
    const line = state.doc.line(lineNum);
    const spaceMatch = line.text.match(/^([ \t]*)/);
    if (spaceMatch) {
      const spaces = spaceMatch[1];
      if (spaces.length > 0) {
        let toRemove = 0;
        let charCount = 0;
        for (let i = 0; i < spaces.length && charCount < 4; i++) {
          if (spaces[i] === '\t') {
            toRemove++;
            charCount += 4;
          } else {
            toRemove++;
            charCount++;
          }
        }
        if (toRemove > 0) {
          changes.push({
            from: line.from,
            to: line.from + toRemove,
            insert: ''
          });
        }
      }
    }
  }

  if (changes.length > 0) {
    view.dispatch({ changes });
  }
  return true;
}

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
        { key: 'Tab', run: indentListCommand },
        { key: 'Shift-Tab', run: outdentListCommand },
        ...markdownKeymap,
        ...closeBracketsKeymap,
        ...defaultKeymap,
        ...historyKeymap,
        ...foldKeymap,
        indentWithTab,
      ]),

      // Theming
      oneDark,
      noteDeskTheme,
      Prec.highest(syntaxHighlighting(noteDeskHighlighting)),

      // Change listener
      updateListener,

      // Live Preview Hide Formatting
      markdownLivePreview,



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

