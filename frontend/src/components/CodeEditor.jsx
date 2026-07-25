import { useCallback, useMemo, useRef } from 'react'
import CodeMirror, { EditorView } from '@uiw/react-codemirror'
import { keymap } from '@codemirror/view'
import { indentWithTab } from '@codemirror/commands'
import { Prec } from '@codemirror/state'
import { HighlightStyle, syntaxHighlighting, StreamLanguage } from '@codemirror/language'
import { tags as t } from '@lezer/highlight'
import { javascript } from '@codemirror/lang-javascript'
import { python } from '@codemirror/lang-python'
import { json } from '@codemirror/lang-json'
import { html } from '@codemirror/lang-html'
import { css } from '@codemirror/lang-css'
import { markdown } from '@codemirror/lang-markdown'
// Additional languages — the standard set candidates code in (official Lezer parsers where they
// exist; legacy StreamLanguage modes for the rest).
import { java } from '@codemirror/lang-java'
import { cpp } from '@codemirror/lang-cpp'
import { rust } from '@codemirror/lang-rust'
import { go } from '@codemirror/lang-go'
import { php } from '@codemirror/lang-php'
import { sql } from '@codemirror/lang-sql'
import { xml } from '@codemirror/lang-xml'
import { yaml } from '@codemirror/lang-yaml'
import { csharp, kotlin, scala } from '@codemirror/legacy-modes/mode/clike'
import { ruby } from '@codemirror/legacy-modes/mode/ruby'
import { swift } from '@codemirror/legacy-modes/mode/swift'
import { shell } from '@codemirror/legacy-modes/mode/shell'
// Popular published editor themes (each bundles its own surface + syntax colors).
import { oneDark } from '@codemirror/theme-one-dark'
import { vscodeDark } from '@uiw/codemirror-theme-vscode'
import { dracula } from '@uiw/codemirror-theme-dracula'
import { githubLight } from '@uiw/codemirror-theme-github'
import { monokai } from '@uiw/codemirror-theme-monokai'
import { Code, FileText } from './icons.jsx'

// CodeEditor — a CodeMirror 6 multi-file editor for the Touchstones candidate
// assessment. A file tab bar sits above a single CodeMirror surface; switching
// tabs swaps the document. Styling follows the warm "stone / clay / paper /
// sand" palette: a paper background, hairline stone borders, terracotta accents.
//
// Props:
//   files            [{ path, content, language }]  the open files (required)
//   activeFile       string   path of the file shown (falls back to files[0])
//   onActiveFileChange(path)  called when the candidate clicks another tab
//   onChange(path, nextContent)  called on every edit of the active file
//   onActivity(event)  small, serializable behavioral events (see below)
//   readOnly         boolean  render read-only (no edits, no keystroke events)
//
// onActivity event shapes (all flat + JSON-serializable):
//   { type: 'keystroke', path, count }    count = chars added/removed this edit
//   { type: 'paste',     path, length }   length = pasted text length (key signal)
//   { type: 'file_switch', from, to }     from is null on the first selection
//   { type: 'focus',     path }
//   { type: 'blur',      path }

// --- Language detection -----------------------------------------------------
// Resolve a CodeMirror language extension from an explicit `language` hint or,
// failing that, the file extension. Unknown types fall back to plain text.
const EXT_LANG = {
  js: 'javascript',
  cjs: 'javascript',
  mjs: 'javascript',
  jsx: 'jsx',
  ts: 'typescript',
  tsx: 'tsx',
  py: 'python',
  pyw: 'python',
  json: 'json',
  jsonc: 'json',
  html: 'html',
  htm: 'html',
  vue: 'html',
  css: 'css',
  scss: 'css',
  less: 'css',
  md: 'markdown',
  markdown: 'markdown',
  mdx: 'markdown',
  // C-family & systems
  java: 'java',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  cc: 'cpp',
  cxx: 'cpp',
  hpp: 'cpp',
  hh: 'cpp',
  cs: 'csharp',
  go: 'go',
  rs: 'rust',
  swift: 'swift',
  kt: 'kotlin',
  kts: 'kotlin',
  scala: 'scala',
  // Scripting & data
  rb: 'ruby',
  php: 'php',
  phtml: 'php',
  sql: 'sql',
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',
  xml: 'xml',
  yaml: 'yaml',
  yml: 'yaml',
}

function normalizeLanguage(file) {
  const explicit = (file.language || '').toLowerCase().trim()
  if (explicit) {
    if (explicit === 'typescriptreact') return 'tsx'
    if (explicit === 'javascriptreact') return 'jsx'
    return explicit
  }
  const ext = (file.path || '').split('.').pop()?.toLowerCase() || ''
  return EXT_LANG[ext] || 'text'
}

function languageExtension(lang) {
  switch (lang) {
    case 'javascript':
      return javascript()
    case 'jsx':
      return javascript({ jsx: true })
    case 'typescript':
    case 'ts':
      return javascript({ typescript: true })
    case 'tsx':
    case 'typescriptreact':
      return javascript({ jsx: true, typescript: true })
    case 'python':
    case 'py':
      return python()
    case 'json':
      return json()
    case 'html':
      return html()
    case 'css':
    case 'scss':
    case 'less':
      return css()
    case 'markdown':
    case 'md':
      return markdown()
    case 'java':
      return java()
    case 'cpp':
    case 'c++':
    case 'cc':
    case 'c':
      return cpp() // lang-cpp covers C as well
    case 'csharp':
    case 'cs':
    case 'c#':
      return StreamLanguage.define(csharp)
    case 'go':
    case 'golang':
      return go()
    case 'rust':
    case 'rs':
      return rust()
    case 'ruby':
    case 'rb':
      return StreamLanguage.define(ruby)
    case 'php':
      return php()
    case 'swift':
      return StreamLanguage.define(swift)
    case 'kotlin':
    case 'kt':
      return StreamLanguage.define(kotlin)
    case 'scala':
      return StreamLanguage.define(scala)
    case 'sql':
      return sql()
    case 'shell':
    case 'bash':
    case 'sh':
      return StreamLanguage.define(shell)
    case 'xml':
      return xml()
    case 'yaml':
    case 'yml':
      return yaml()
    default:
      return null
  }
}

// --- Theme ------------------------------------------------------------------
// Light, paper-toned editor chrome. Mirrors the app's hairline borders and warm
// neutrals; the active line and selection use translucent clay so the accent
// stays singular and soft.
const baseTheme = EditorView.theme(
  {
    '&': {
      backgroundColor: '#FCF9F3', // canvas
      color: '#221E18', // ink
      fontSize: '13px',
      height: '100%',
    },
    '&.cm-focused': { outline: 'none' },
    '.cm-scroller': {
      fontFamily:
        "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace",
      lineHeight: '1.7',
    },
    '.cm-content': { padding: '12px 0', caretColor: '#4358D0' },
    '.cm-gutters': {
      backgroundColor: '#FCF9F3',
      color: '#AEB7D0', // stone-400
      border: 'none',
      borderRight: '1px solid #F2ECE2', // stone-100
    },
    '.cm-lineNumbers .cm-gutterElement': { padding: '0 12px 0 14px', minWidth: '34px' },
    '.cm-activeLineGutter': { backgroundColor: 'rgba(67,88,208,0.06)', color: '#6A5D4D' },
    '.cm-activeLine': { backgroundColor: 'rgba(67,88,208,0.05)' },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: '#4358D0' },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': {
      backgroundColor: 'rgba(67,88,208,0.16)',
    },
    '.cm-matchingBracket': {
      backgroundColor: 'rgba(67,88,208,0.18)',
      color: 'inherit',
      outline: '1px solid rgba(67,88,208,0.4)',
    },
    '.cm-nonmatchingBracket': { backgroundColor: 'rgba(158,53,40,0.18)' },
    '.cm-selectionMatch': { backgroundColor: 'rgba(137,123,103,0.18)' },
    '.cm-foldPlaceholder': {
      backgroundColor: '#F2ECE2',
      border: 'none',
      color: '#6A5D4D',
      padding: '0 6px',
      borderRadius: '4px',
    },
    '.cm-tooltip': {
      backgroundColor: '#FFFFFF',
      border: '1px solid #E7DDCF',
      borderRadius: '8px',
      boxShadow: '0 8px 24px -12px rgba(34,30,24,0.18)',
    },
  },
  { dark: false },
)

// Syntax colors — warm, low-saturation palette that reads as ink with clay and
// stone accents rather than a rainbow. Keeps the editor on-brand and calm.
const highlightStyle = HighlightStyle.define([
  { tag: [t.comment, t.lineComment, t.blockComment], color: '#AEB7D0', fontStyle: 'italic' },
  { tag: [t.keyword, t.modifier, t.controlKeyword, t.operatorKeyword], color: '#3448C5' },
  { tag: [t.string, t.special(t.string), t.regexp], color: '#6A5D4D' },
  { tag: [t.number, t.bool, t.null, t.atom], color: '#9E3528' },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: '#27389E' },
  { tag: [t.definition(t.variableName), t.variableName], color: '#221E18' },
  { tag: [t.propertyName], color: '#6A5D4D' },
  { tag: [t.typeName, t.className, t.namespace], color: '#3448C5' },
  { tag: [t.tagName, t.angleBracket], color: '#3448C5' },
  { tag: [t.attributeName], color: '#27389E' },
  { tag: [t.attributeValue], color: '#6A5D4D' },
  { tag: [t.propertyName, t.labelName], color: '#27389E' },
  { tag: [t.operator, t.punctuation, t.separator, t.bracket], color: '#897B67' },
  { tag: [t.meta, t.documentMeta], color: '#AEB7D0' },
  { tag: [t.heading], color: '#4358D0', fontWeight: '600' },
  { tag: [t.strong], fontWeight: '600' },
  { tag: [t.emphasis], fontStyle: 'italic' },
  { tag: [t.link, t.url], color: '#3448C5', textDecoration: 'underline' },
  { tag: [t.list, t.quote], color: '#6A5D4D' },
  { tag: [t.invalid], color: '#9E3528' },
])

const themeExtensions = [baseTheme, syntaxHighlighting(highlightStyle)]

// --- Dark theme -------------------------------------------------------------
// Warm, low-saturation dark (Gruvbox-adjacent) — same "no rainbow" intent as the
// light theme, just inverted onto a deep warm canvas with clay/amber accents.
const darkBaseTheme = EditorView.theme(
  {
    '&': { backgroundColor: '#11182B', color: '#F4F6FF', fontSize: '13px', height: '100%' },
    '&.cm-focused': { outline: 'none' },
    '.cm-scroller': {
      fontFamily:
        "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace",
      lineHeight: '1.7',
    },
    '.cm-content': { padding: '12px 0', caretColor: '#9DA9EF' },
    '.cm-gutters': {
      backgroundColor: '#11182B',
      color: '#8490AE',
      border: 'none',
      borderRight: '1px solid #25304D',
    },
    '.cm-lineNumbers .cm-gutterElement': { padding: '0 12px 0 14px', minWidth: '34px' },
    '.cm-activeLineGutter': { backgroundColor: 'rgba(67,88,208,0.16)', color: '#DDE2FF' },
    '.cm-activeLine': { backgroundColor: 'rgba(67,88,208,0.10)' },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: '#9DA9EF' },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': {
      backgroundColor: 'rgba(224,147,111,0.25)',
    },
    '.cm-matchingBracket': {
      backgroundColor: 'rgba(224,147,111,0.22)',
      color: 'inherit',
      outline: '1px solid rgba(224,147,111,0.5)',
    },
    '.cm-nonmatchingBracket': { backgroundColor: 'rgba(240,132,106,0.22)' },
    '.cm-selectionMatch': { backgroundColor: 'rgba(169,154,133,0.20)' },
    '.cm-foldPlaceholder': {
      backgroundColor: '#25304D',
      border: 'none',
      color: '#DDE2FF',
      padding: '0 6px',
      borderRadius: '4px',
    },
    '.cm-tooltip': {
      backgroundColor: '#18213A',
      border: '1px solid #303C5C',
      borderRadius: '8px',
      boxShadow: '0 8px 24px -12px rgba(0,0,0,0.5)',
    },
  },
  { dark: true },
)

const darkHighlightStyle = HighlightStyle.define([
  { tag: [t.comment, t.lineComment, t.blockComment], color: '#8490AE', fontStyle: 'italic' },
  { tag: [t.keyword, t.modifier, t.controlKeyword, t.operatorKeyword], color: '#E0905E' },
  { tag: [t.string, t.special(t.string), t.regexp], color: '#CDBA98' },
  { tag: [t.number, t.bool, t.null, t.atom], color: '#F0846A' },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: '#9DA9EF' },
  { tag: [t.definition(t.variableName), t.variableName], color: '#F4F6FF' },
  { tag: [t.propertyName], color: '#CDBA98' },
  { tag: [t.typeName, t.className, t.namespace], color: '#E0905E' },
  { tag: [t.tagName, t.angleBracket], color: '#E0905E' },
  { tag: [t.attributeName], color: '#9DA9EF' },
  { tag: [t.attributeValue], color: '#CDBA98' },
  { tag: [t.labelName], color: '#9DA9EF' },
  { tag: [t.operator, t.punctuation, t.separator, t.bracket], color: '#AEB7D0' },
  { tag: [t.meta, t.documentMeta], color: '#8490AE' },
  { tag: [t.heading], color: '#9DA9EF', fontWeight: '600' },
  { tag: [t.strong], fontWeight: '600' },
  { tag: [t.emphasis], fontStyle: 'italic' },
  { tag: [t.link, t.url], color: '#E0905E', textDecoration: 'underline' },
  { tag: [t.list, t.quote], color: '#CDBA98' },
  { tag: [t.invalid], color: '#F0846A' },
])

const darkThemeExtensions = [darkBaseTheme, syntaxHighlighting(darkHighlightStyle)]

// Pin the editor surface + gutter to the SAME color as the surrounding IDE chrome so the background
// is consistent no matter which theme is picked. Published themes each bring their own background
// (VS Code #1e1e1e, Dracula #282a36, Monokai #272822…) which clashes with the Touchstones frame;
// this keeps their syntax colors but unifies the surface. Appended last so it wins.
const CHROME_DARK = '#11182B'
const CHROME_LIGHT = '#FCF9F3'
const surfaceUnifyDark = EditorView.theme(
  {
    // Pin EVERY surface layer to one color so published themes (VS Code, Dracula, Monokai, one-dark)
    // don't leave a mismatched bg in the content, the empty area below the code, or the gutter.
    '&': { backgroundColor: CHROME_DARK },
    '.cm-editor': { backgroundColor: CHROME_DARK },
    '.cm-scroller': { backgroundColor: CHROME_DARK },
    '.cm-content': { backgroundColor: CHROME_DARK },
    '.cm-gutters': { backgroundColor: CHROME_DARK, border: 'none' },
    '.cm-activeLineGutter': { backgroundColor: 'rgba(67,88,208,0.16)' },
  },
  { dark: true },
)
const surfaceUnifyLight = EditorView.theme({
  '&': { backgroundColor: CHROME_LIGHT },
  '.cm-editor': { backgroundColor: CHROME_LIGHT },
  '.cm-scroller': { backgroundColor: CHROME_LIGHT },
  '.cm-content': { backgroundColor: CHROME_LIGHT },
  '.cm-gutters': { backgroundColor: CHROME_LIGHT, border: 'none' },
})

// Preset key (see lib/editorThemes.js) → CodeMirror theme extensions. Touchstones uses our hand-
// tuned warm themes; the rest are the well-known published themes engineers expect. Every non-native
// theme gets the surface-unify override so the editor bg always matches the chrome.
// Prec.highest so the surface override beats the published theme's own &/.cm-gutters background
// rules (equal specificity otherwise lets the theme win the cascade → mismatched shades).
const unifyDark = Prec.highest(surfaceUnifyDark)
const unifyLight = Prec.highest(surfaceUnifyLight)
const THEME_EXTENSIONS = {
  'touchstones-light': themeExtensions,
  'touchstones-dark': darkThemeExtensions,
  'vscode-dark': [vscodeDark, unifyDark],
  'one-dark': [oneDark, unifyDark],
  'leetcode-dark': [oneDark, unifyDark],
  dracula: [dracula, unifyDark],
  monokai: [monokai, unifyDark],
  'github-light': [githubLight, unifyLight],
}

const basicSetupOptions = {
  lineNumbers: true,
  foldGutter: true,
  highlightActiveLine: true,
  highlightActiveLineGutter: true,
  bracketMatching: true,
  closeBrackets: true,
  indentOnInput: true,
  autocompletion: true, // in-buffer word + bracket completion (no language server)
  highlightSelectionMatches: true,
}

export default function CodeEditor({
  files = [],
  activeFile,
  onActiveFileChange,
  onChange,
  onActivity,
  onRunShortcut, // called on Cmd/Ctrl+Enter (wired to the Run button)
  readOnly = false,
  fill = false, // when true, fills the parent height (IDE split-pane) instead of a bounded card
  theme = 'touchstones-light', // preset key from lib/editorThemes.js
}) {
  // Keep the latest run callback in a ref so the keymap (built in a useMemo) reads it without
  // rebuilding the extensions on every parent render.
  const onRunRef = useRef(onRunShortcut)
  onRunRef.current = onRunShortcut
  // Resolve the active file; fall back to the first one so the editor never
  // renders an empty surface when `activeFile` is unset or stale.
  const active = useMemo(() => {
    if (!files.length) return null
    return files.find((f) => f.path === activeFile) || files[0]
  }, [files, activeFile])

  const activePath = active?.path ?? null

  // Track the previously active path so file_switch events carry an accurate
  // `from`. A ref avoids re-subscribing the editor on every switch.
  const prevPathRef = useRef(activePath)

  const extensions = useMemo(() => {
    const langExt = active ? languageExtension(normalizeLanguage(active)) : null
    const exts = [
      ...(THEME_EXTENSIONS[theme] || darkThemeExtensions),
      EditorView.lineWrapping,
      // Cmd/Ctrl+Enter → Run (universal in coding editors); Tab indents instead of moving focus.
      // Prec.high so Mod-Enter beats basicSetup's defaultKeymap (which binds it to insertBlankLine).
      Prec.high(
        keymap.of([
          {
            key: 'Mod-Enter',
            run: () => {
              // Only consume the key when Run is actually wired (single-file IDE, run allowed);
              // otherwise let the editor's default handling proceed.
              if (!onRunRef.current) return false
              onRunRef.current()
              return true
            },
          },
          indentWithTab,
        ]),
      ),
    ]
    if (langExt) exts.push(langExt)
    return exts
  }, [active, theme])

  const emit = useCallback(
    (event) => {
      if (typeof onActivity === 'function') onActivity(event)
    },
    [onActivity],
  )

  // Document changes → onChange + keystroke activity. We derive a character
  // `count` (added + removed) from the ChangeSet so a paste registers its true
  // size and a single key registers as 1 — without ever reading the content.
  const handleChange = useCallback(
    (value, viewUpdate) => {
      if (!activePath) return
      onChange?.(activePath, value)

      if (readOnly) return
      let changed = 0
      try {
        viewUpdate?.changes?.iterChanges((fromA, toA, fromB, toB) => {
          changed += toA - fromA + (toB - fromB)
        })
      } catch {
        changed = 1
      }
      // Pastes/drops are reported via the DOM handler below with an exact length;
      // skip the keystroke event for those so we don't double-count. CodeMirror
      // tags those transactions with the 'input.paste' / 'input.drop' user event.
      const isPaste = viewUpdate?.transactions?.some(
        (tr) => tr.isUserEvent('input.paste') || tr.isUserEvent('input.drop'),
      )
      if (isPaste) return
      if (changed > 0) emit({ type: 'keystroke', path: activePath, count: changed })
    },
    [activePath, onChange, emit, readOnly],
  )

  // DOM-level paste handler — the only reliable place to read the pasted text's
  // LENGTH (a critical integrity signal). We capture length only, never content.
  const domHandlers = useMemo(
    () => ({
      paste: (cmEvent) => {
        if (!activePath) return false
        const text = cmEvent.clipboardData?.getData('text') ?? ''
        emit({ type: 'paste', path: activePath, length: text.length })
        return false // let CodeMirror apply the paste normally
      },
      focus: () => {
        if (activePath) emit({ type: 'focus', path: activePath })
        return false
      },
      blur: () => {
        if (activePath) emit({ type: 'blur', path: activePath })
        return false
      },
    }),
    [activePath, emit],
  )

  const eventHandlersExtension = useMemo(
    () => EditorView.domEventHandlers(domHandlers),
    [domHandlers],
  )

  const selectFile = useCallback(
    (path) => {
      if (path === activePath) return
      const from = prevPathRef.current
      prevPathRef.current = path
      onActiveFileChange?.(path)
      emit({ type: 'file_switch', from, to: path })
    },
    [activePath, onActiveFileChange, emit],
  )

  if (!active) {
    return (
      <div className="flex min-h-[360px] items-center justify-center rounded-2xl border border-stone-200 bg-canvas text-sm text-stone-400">
        No files to edit.
      </div>
    )
  }

  return (
    <div
      className={`flex flex-col overflow-hidden bg-canvas dark:bg-[#11182B] ${
        fill ? 'h-full min-h-0' : 'min-h-[360px] rounded-2xl border border-stone-200 shadow-card'
      }`}
    >
      {/* File tab bar */}
      <div
        role="tablist"
        aria-label="Open files"
        className="flex items-stretch gap-0.5 overflow-x-auto border-b border-stone-200 bg-sand/60 px-1.5 pt-1.5 dark:border-[#25304D] dark:bg-[#090E1C]"
      >
        {files.map((f) => {
          const isActive = f.path === activePath
          return (
            <button
              key={f.path}
              role="tab"
              type="button"
              aria-selected={isActive}
              onClick={() => selectFile(f.path)}
              title={f.path}
              className={[
                'group inline-flex shrink-0 items-center gap-1.5 rounded-t-lg border border-b-0 px-3 py-1.5 text-xs font-medium transition-colors',
                isActive
                  ? 'border-stone-200 bg-canvas text-ink dark:border-[#25304D] dark:bg-[#11182B] dark:text-[#F4F6FF]'
                  : 'border-transparent bg-transparent text-stone-500 hover:bg-canvas/60 hover:text-stone-700 dark:text-[#AEB7D0] dark:hover:bg-[#11182B] dark:hover:text-[#F4F6FF]',
              ].join(' ')}
            >
              <FileIcon path={f.path} active={isActive} />
              <span className="max-w-[180px] truncate">{tabLabel(f.path)}</span>
            </button>
          )
        })}
      </div>

      {/* Editor surface */}
      <div className="min-h-0 flex-1">
        <CodeMirror
          // Key on path so switching tabs fully remounts the document state —
          // simplest correct way to swap files without cross-contaminating
          // history/selection between unrelated buffers.
          key={activePath}
          value={active.content ?? ''}
          // react-codemirror wraps the editor in its own .cm-theme div, which has NO height of
          // its own; without h-full here, height="100%" below resolves against an auto-height
          // parent, the editor grows with the content, and internal scrolling never engages
          // (the pane clips instead; wheel events fall through to the page).
          className="h-full"
          height="100%"
          minHeight="320px"
          // "none" so our own EditorView.theme (light or dark, via extensions) fully controls the
          // surface — passing "light" here paints a white background that overrides dark mode.
          theme="none"
          editable={!readOnly}
          readOnly={readOnly}
          basicSetup={basicSetupOptions}
          extensions={[...extensions, eventHandlersExtension]}
          onChange={handleChange}
        />
      </div>
    </div>
  )
}

// Short label for a tab: the basename, but keep a parent dir when it adds
// clarity (e.g. several index.js files).
function tabLabel(path = '') {
  const parts = path.split('/').filter(Boolean)
  return parts[parts.length - 1] || path
}

function FileIcon({ path, active }) {
  const lang = normalizeLanguage({ path })
  const isCodey = lang !== 'markdown' && lang !== 'text'
  const Icon = isCodey ? Code : FileText
  return (
    <Icon
      size={13}
      className={active ? 'text-clay-500' : 'text-stone-400 group-hover:text-stone-500'}
    />
  )
}
