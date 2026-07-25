// Editor color themes a candidate can pick. This file is METADATA ONLY (label + whether it's a dark
// theme, so the IDE chrome can match) — intentionally free of any CodeMirror import so the page and
// the dropdown can list themes without pulling the heavy (lazy-loaded) editor bundle. The actual
// theme extensions are resolved by these keys inside CodeEditor.jsx.

export const DEFAULT_EDITOR_THEME = 'touchstones-dark'
export const EDITOR_THEME_STORAGE_KEY = 'ts_editor_theme'

export const EDITOR_THEMES = [
  { key: 'touchstones-dark', label: 'Touchstones Dark', dark: true },
  { key: 'touchstones-light', label: 'Touchstones Light', dark: false },
  { key: 'vscode-dark', label: 'VS Code Dark', dark: true },
  { key: 'leetcode-dark', label: 'LeetCode', dark: true },
  { key: 'one-dark', label: 'One Dark', dark: true },
  { key: 'dracula', label: 'Dracula', dark: true },
  { key: 'monokai', label: 'Monokai', dark: true },
  { key: 'github-light', label: 'GitHub Light', dark: false },
]

export function isEditorThemeDark(key) {
  const t = EDITOR_THEMES.find((x) => x.key === key)
  return t ? t.dark : true
}

// Resolve a stored value to a valid theme key (handles the old 'light'/'dark' values + unknowns).
export function normalizeEditorTheme(stored) {
  if (stored === 'light') return 'touchstones-light'
  if (stored === 'dark') return 'touchstones-dark'
  return EDITOR_THEMES.some((t) => t.key === stored) ? stored : DEFAULT_EDITOR_THEME
}
