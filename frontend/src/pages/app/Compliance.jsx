import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../../services/api.js'
import { ErrorState, EmptyState } from '../../components/states.jsx'
import { Pill } from '../../components/primitives.jsx'
import { ShieldCheck, FileText, Check, Flag, Download } from '../../components/icons.jsx'

// Compliance & Adverse-Impact (CC1 v3).
// ----------------------------------------------------------------------------------------
// Two artifacts a regulated / enterprise buyer needs to deploy an automated screen:
//   A. A per-role defensibility export (no protected attributes) — explainable, rubric-derived,
//      code-computed scores bound to the audit chain. The everyday record.
//   B. An OPT-IN EEOC four-fifths adverse-impact analysis, run only over group labels the
//      employer voluntarily provides (segregated, never affects scoring, honest small-n handling).
// Decision-support, not a legal certification. Plain language, terracotta only.

function humanizeRole(rf) {
  if (!rf) return 'Unspecified'
  return String(rf).replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}
const OUTCOME_LABELS = { advanced: 'Advanced', got_offer: 'Got offer', hired: 'Hired' }
const pct = (rate) => (rate == null ? '—' : `${Math.round(rate * 1000) / 10}%`)

function downloadJson(filename, obj) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

// One row of the four-fifths table.
function GroupRow({ g, reference }) {
  const isRef = reference && g.value === reference
  const flagged = g.impact_ratio != null && g.impact_ratio < 0.8
  return (
    <tr className="border-t border-stone-100">
      <td className="py-2.5 pr-4 text-sm font-medium text-ink">
        {g.value}
        {isRef && <span className="ml-2 text-[0.7rem] font-normal text-stone-400">(reference)</span>}
      </td>
      <td className="py-2.5 pr-4 text-sm tabular-nums text-stone-600">{g.n}</td>
      <td className="py-2.5 pr-4 text-sm tabular-nums text-stone-600">{g.selected}</td>
      <td className="py-2.5 pr-4 text-sm tabular-nums text-stone-700">{g.sufficient ? pct(g.rate) : '—'}</td>
      <td className="py-2.5 pr-4 text-sm tabular-nums text-ink">{g.impact_ratio == null ? '—' : g.impact_ratio.toFixed(2)}</td>
      <td className="py-2.5">
        {!g.sufficient ? (
          <Pill tone="amber">insufficient data</Pill>
        ) : g.impact_ratio == null ? (
          <Pill tone="neutral">—</Pill>
        ) : flagged ? (
          <Pill tone="flag"><Flag size={12} /> below 0.80</Pill>
        ) : (
          <Pill tone="clay"><Check size={12} /> ≥ 0.80</Pill>
        )}
      </td>
    </tr>
  )
}

export default function Compliance() {
  const [meta, setMeta] = useState({ roles: [], labels: [], selectable_outcomes: ['advanced', 'got_offer', 'hired'], min_group_sample: 5 })
  const [metaState, setMetaState] = useState('loading') // loading | ok | error
  const [role, setRole] = useState('')
  const [attribute, setAttribute] = useState('')
  const [outcome, setOutcome] = useState('advanced')
  const [analysis, setAnalysis] = useState(null)
  const [runState, setRunState] = useState('idle') // idle | loading | ok | error
  const [runError, setRunError] = useState('')
  const [exporting, setExporting] = useState(false)
  const [labelText, setLabelText] = useState('')
  const [uploadMsg, setUploadMsg] = useState(null)

  const loadMeta = useCallback(() => {
    setMetaState('loading')
    api
      .getComplianceRoles()
      .then((m) => {
        setMeta(m)
        setMetaState('ok')
        if (!role && m.roles?.length) setRole(m.roles[0])
        if (!attribute && m.labels?.length) setAttribute(m.labels[0].attribute)
      })
      .catch(() => setMetaState('error'))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { loadMeta() }, [loadMeta])

  const attributes = useMemo(() => (meta.labels || []).map((l) => l.attribute), [meta])

  const runAnalysis = useCallback(() => {
    if (!role || !attribute) return
    setRunState('loading')
    setRunError('')
    api
      .getAdverseImpact(role, { attribute, outcome })
      .then((a) => { setAnalysis(a); setRunState('ok') })
      .catch((e) => { setRunError(e?.message || 'Could not run the analysis.'); setRunState('error') })
  }, [role, attribute, outcome])

  async function downloadExport() {
    if (!role) return
    setExporting(true)
    try {
      const out = await api.getComplianceRoleExport(role)
      downloadJson(`defensibility-${role}-${new Date().toISOString().slice(0, 10)}.json`, out)
    } catch (e) {
      setUploadMsg({ kind: 'error', text: e?.message || 'Export failed.' })
    } finally {
      setExporting(false)
    }
  }

  async function uploadLabels() {
    // Parse "submission_id, attribute, value" lines (CSV-ish). Voluntary + segregated.
    const rows = labelText
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => l.split(',').map((c) => c.trim()))
      .filter((c) => c.length >= 3)
      .map(([submission_id, attr, value]) => ({ submission_id, attribute: attr, value }))
    if (!rows.length) {
      setUploadMsg({ kind: 'error', text: 'Add one or more lines: submission_id, attribute, value' })
      return
    }
    setUploadMsg({ kind: 'loading', text: 'Attaching…' })
    try {
      const res = await api.attachComplianceLabels(rows)
      setUploadMsg({ kind: 'ok', text: `Attached ${res.attached}${res.skipped_count ? `, skipped ${res.skipped_count}` : ''}.` })
      setLabelText('')
      loadMeta()
    } catch (e) {
      setUploadMsg({ kind: 'error', text: e?.message || 'Upload failed.' })
    }
  }

  const flagged = analysis && analysis.ok && !analysis.insufficient && analysis.flagged
  const passed = analysis && analysis.ok && !analysis.insufficient && !analysis.flagged

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <header>
        <div className="flex items-center gap-2 text-clay-600"><ShieldCheck size={18} /><span className="text-xs font-semibold uppercase tracking-[0.14em]">Compliance</span></div>
        <h1 className="mt-2 text-2xl font-semibold text-ink">Compliance &amp; adverse-impact</h1>
        <p className="mt-1 max-w-2xl text-sm leading-relaxed text-stone-600">
          The paper trail to deploy an automated screen defensibly: an explainable, rubric-derived,
          code-computed record bound to the audit chain — plus an <strong>opt-in</strong> EEOC
          four-fifths analysis. Touchstones never collects or infers protected attributes, and labels
          never touch scoring.
        </p>
      </header>

      {metaState === 'error' && <ErrorState title="Couldn’t load compliance data" onRetry={loadMeta} />}

      {/* A. Defensibility export */}
      <section className="rounded-2xl border border-stone-200 bg-white p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-semibold text-ink"><FileText size={16} /> Defensibility export</h2>
            <p className="mt-1 max-w-xl text-sm leading-relaxed text-stone-500">
              A downloadable per-role record — the rubric, per-criterion points + evidence, the
              code-computed score, the proof-of-human state, and the audit-chain reference. No
              protected attributes. The everyday artifact for an LL-144 auditor or legal review.
            </p>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <label className="text-xs font-medium text-stone-500">Role</label>
          <select value={role} onChange={(e) => setRole(e.target.value)} className="rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm text-ink">
            {(meta.roles || []).length === 0 && <option value="">No roles yet</option>}
            {(meta.roles || []).map((r) => <option key={r} value={r}>{humanizeRole(r)}</option>)}
          </select>
          <button type="button" onClick={downloadExport} disabled={!role || exporting} className="btn-primary inline-flex items-center gap-2 disabled:opacity-50">
            <Download size={15} /> {exporting ? 'Preparing…' : 'Download defensibility export'}
          </button>
        </div>
      </section>

      {/* B. Adverse-impact (four-fifths) */}
      <section className="rounded-2xl border border-stone-200 bg-white p-5">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-ink"><ShieldCheck size={16} /> Adverse-impact analysis (four-fifths rule)</h2>
        <p className="mt-1 max-w-2xl text-sm leading-relaxed text-stone-500">
          Selection rate per group = selected ÷ total; impact ratio = group rate ÷ the highest group
          rate. A ratio below <strong>0.80</strong> flags potential adverse impact. Groups with fewer
          than {meta.min_group_sample} labeled decisions are shown as <em>insufficient data</em>.
        </p>

        {attributes.length === 0 ? (
          <EmptyState
            className="mt-5"
            icon={<ShieldCheck size={18} />}
            title="No group labels provided"
            hint="The four-fifths analysis runs only on labels you voluntarily attach below. Touchstones never collects or infers them."
          />
        ) : (
          <>
            <div className="mt-4 flex flex-wrap items-end gap-3">
              <div>
                <label className="block text-xs font-medium text-stone-500">Role</label>
                <select value={role} onChange={(e) => setRole(e.target.value)} className="mt-1 rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm text-ink">
                  {(meta.roles || []).map((r) => <option key={r} value={r}>{humanizeRole(r)}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-stone-500">Attribute</label>
                <select value={attribute} onChange={(e) => setAttribute(e.target.value)} className="mt-1 rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm text-ink">
                  {attributes.map((a) => <option key={a} value={a}>{a}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-stone-500">Selected =</label>
                <select value={outcome} onChange={(e) => setOutcome(e.target.value)} className="mt-1 rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm text-ink">
                  {(meta.selectable_outcomes || []).map((o) => <option key={o} value={o}>{OUTCOME_LABELS[o] || o}</option>)}
                </select>
              </div>
              <button type="button" onClick={runAnalysis} disabled={!role || !attribute || runState === 'loading'} className="btn-primary disabled:opacity-50">
                {runState === 'loading' ? 'Computing…' : 'Run analysis'}
              </button>
            </div>

            {runState === 'error' && <ErrorState className="mt-4" title="Couldn’t run the analysis" hint={runError} onRetry={runAnalysis} />}

            {analysis && analysis.ok && runState === 'ok' && (
              <div className="mt-5">
                {analysis.no_labels ? (
                  <EmptyState icon={<ShieldCheck size={18} />} title="No labels for this attribute / role yet" hint="Attach labels below to run the analysis." />
                ) : (
                  <>
                    {flagged && (
                      <div className="mb-3 flex items-center gap-2 rounded-xl border border-flag-100 bg-flag-50 px-4 py-3 text-sm text-flag-700">
                        <Flag size={16} /> One or more groups fall below the 0.80 four-fifths threshold — review with counsel.
                      </div>
                    )}
                    {passed && (
                      <div className="mb-3 flex items-center gap-2 rounded-xl border border-clay-200 bg-clay-50 px-4 py-3 text-sm text-clay-700">
                        <Check size={16} /> All sufficiently-sampled groups meet the 0.80 four-fifths threshold.
                      </div>
                    )}
                    {analysis.insufficient && (
                      <div className="mb-3 flex items-center gap-2 rounded-xl border border-amber-100 bg-amber-50 px-4 py-3 text-sm text-amber-700">
                        <Flag size={16} /> Insufficient data to compute a comparison ({analysis.reason}). Counts shown; ratios suppressed.
                      </div>
                    )}
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[34rem]">
                        <thead>
                          <tr className="text-left text-[0.7rem] uppercase tracking-wide text-stone-400">
                            <th className="pb-2 pr-4 font-medium">Group</th>
                            <th className="pb-2 pr-4 font-medium">n</th>
                            <th className="pb-2 pr-4 font-medium">selected</th>
                            <th className="pb-2 pr-4 font-medium">rate</th>
                            <th className="pb-2 pr-4 font-medium">impact ratio</th>
                            <th className="pb-2 font-medium">four-fifths</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(analysis.groups || []).map((g) => <GroupRow key={g.value} g={g} reference={analysis.reference_value} />)}
                        </tbody>
                      </table>
                    </div>
                    <p className="mt-3 text-xs text-stone-400">
                      {analysis.total_n} labeled decision{analysis.total_n === 1 ? '' : 's'} across {analysis.groups_total} group{analysis.groups_total === 1 ? '' : 's'}, selected = {OUTCOME_LABELS[analysis.selected_outcome] || analysis.selected_outcome}.
                    </p>
                  </>
                )}
              </div>
            )}
          </>
        )}

        {/* Methodology + counsel note (always visible) */}
        <div className="mt-6 rounded-xl border border-stone-200 bg-canvas/50 p-4">
          <p className="text-xs leading-relaxed text-stone-500">
            Four-fifths (80%) rule (EEOC Uniform Guidelines): selection rate = selected ÷ total per group;
            impact ratio = group rate ÷ the highest group rate; below 0.80 flags potential adverse impact.
            Below {meta.min_group_sample} labeled decisions a group is reported as insufficient data.
          </p>
          <p className="mt-2 text-xs font-medium text-stone-600">
            This is decision-support analysis, not a legal opinion or a certification of compliance.
            Review results with qualified employment counsel before relying on them.
          </p>
        </div>
      </section>

      {/* Opt-in labels uploader */}
      <section className="rounded-2xl border border-stone-200 bg-white p-5">
        <h2 className="text-sm font-semibold text-ink">Attach group labels (voluntary, segregated)</h2>
        <p className="mt-1 max-w-2xl text-sm leading-relaxed text-stone-500">
          Optional. Paste one line per decision as <code className="rounded bg-stone-100 px-1 py-0.5 text-[0.7rem]">submission_id, attribute, value</code>
          {' '}— e.g. <code className="rounded bg-stone-100 px-1 py-0.5 text-[0.7rem]">…uuid…, race_ethnicity, Group A</code>. These labels are stored in your
          own access-locked table, never shown to candidates, and never affect scoring. You provide them; Touchstones never collects or infers them.
        </p>
        <textarea
          value={labelText}
          onChange={(e) => setLabelText(e.target.value)}
          rows={4}
          placeholder="submission_id, attribute, value"
          className="mt-3 w-full rounded-xl border border-stone-200 bg-white p-3 font-mono text-xs text-ink placeholder:text-stone-300"
        />
        <div className="mt-3 flex items-center gap-3">
          <button type="button" onClick={uploadLabels} className="btn-primary">Attach labels</button>
          {uploadMsg && (
            <span className={`text-xs ${uploadMsg.kind === 'error' ? 'text-flag-600' : uploadMsg.kind === 'ok' ? 'text-clay-700' : 'text-stone-500'}`}>
              {uploadMsg.text}
            </span>
          )}
        </div>
      </section>
    </div>
  )
}
