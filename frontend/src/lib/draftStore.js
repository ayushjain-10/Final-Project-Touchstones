// Local draft persistence for the candidate code editor — so a refresh, crash, or accidental tab
// close never loses in-progress work. A coding screen is a one-shot, timed session that can't be
// redone, so losing typed code is a trust failure the practice products never face. Drafts live in
// localStorage keyed by the assessment scope (submission, else work-sample preview) and hold the
// on-screen files plus every language's buffer — mirroring how LeetCode keeps your code per
// (problem, language). Demo previews are never persisted (no scope).

const PREFIX = 'ts_draft:'
const VERSION = 1

function keyFor(scopeId) {
  return `${PREFIX}${scopeId}`
}

// Stored shape: { v, files: [{path,content,language}], activeLang, buffers: {langKey:content}, text, checks, updatedAt }
export function loadDrafts(scopeId) {
  if (!scopeId) return null
  try {
    const raw = localStorage.getItem(keyFor(scopeId))
    if (!raw) return null
    const data = JSON.parse(raw)
    if (!data || data.v !== VERSION) return null
    return {
      files: Array.isArray(data.files) ? data.files : [],
      activeLang: typeof data.activeLang === 'string' ? data.activeLang : null,
      buffers: data.buffers && typeof data.buffers === 'object' ? data.buffers : {},
      text: typeof data.text === 'string' ? data.text : '',
      // Checked deliverables-item indexes (TOU-146). Additive: older drafts restore as [].
      checks: Array.isArray(data.checks) ? data.checks : [],
      updatedAt: data.updatedAt || 0,
    }
  } catch {
    return null
  }
}

// Persist the on-screen files (the source of truth for restore) + the per-language buffer map and
// which language is active (for the single-file language-switch UX). `text` carries the free-text
// (markdown) answer for non-code screens, same never-lose-work guarantee. `checks` carries the
// deliverables self-check state so ticked boxes survive a reload too.
export function saveDrafts(scopeId, { files, activeLang, buffers, text, checks }) {
  if (!scopeId) return
  try {
    localStorage.setItem(
      keyFor(scopeId),
      JSON.stringify({
        v: VERSION,
        files: Array.isArray(files) ? files : [],
        activeLang: activeLang || null,
        buffers: buffers || {},
        text: typeof text === 'string' ? text : '',
        checks: Array.isArray(checks) ? checks : [],
        updatedAt: Date.now(),
      }),
    )
  } catch {
    /* quota exceeded / storage disabled — non-blocking */
  }
}

export function clearDrafts(scopeId) {
  if (!scopeId) return
  try {
    localStorage.removeItem(keyFor(scopeId))
  } catch {
    /* ignore */
  }
}
