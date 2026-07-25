import { useState } from 'react'
import { api } from '../services/api.js'
import { Code, Check } from './icons.jsx'
import TestCaseResults from './TestCaseResults.jsx'

// Recruiter-side "run the candidate's code against the hidden tests in an isolated
// sandbox" panel. On-demand (explicit, auditable) rather than auto. Degrades quietly
// when execution isn't configured or the screen has no hidden tests.
export default function ExecutionPanel({ submissionId }) {
  const [state, setState] = useState('idle') // idle | running | done | error | unavailable | notests
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const [baseline, setBaseline] = useState(null)
  const [bState, setBState] = useState('idle') // idle | running | done | na | error

  async function run() {
    setState('running')
    setError(null)
    try {
      const r = await api.runSubmission(submissionId)
      if (r && r.available === false) return setState('unavailable')
      if (r && r.ran === false) {
        setResult(r)
        return setState('notests')
      }
      setResult(r)
      setState('done')
    } catch (e) {
      setError(e.message || 'Could not run the tests.')
      setState('error')
    }
  }

  async function runBaseline() {
    setBState('running')
    try {
      const r = await api.runBaseline(submissionId)
      if (!r || r.available === false || r.ran === false) return setBState('na')
      setBaseline(r)
      setBState('done')
    } catch {
      setBState('error')
    }
  }

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between gap-3">
        <h3 className="inline-flex items-center gap-2 font-serif text-base font-semibold text-ink">
          <Code size={16} className="text-stone-400" /> Hidden tests
        </h3>
        {state !== 'unavailable' && (
          <button onClick={run} disabled={state === 'running'} className="btn-quiet text-sm">
            {state === 'running'
              ? 'Running…'
              : state === 'done' || state === 'notests'
                ? 'Re-run'
                : 'Run tests'}
          </button>
        )}
      </div>
      <p className="mt-2 text-xs leading-relaxed text-stone-500">
        Runs the candidate's code in an isolated sandbox — objective pass/fail, not an LLM's opinion.
      </p>

      {state === 'unavailable' && (
        <p className="mt-3 text-sm text-stone-500">Code execution isn't enabled in this deployment.</p>
      )}
      {state === 'notests' && (
        <p className="mt-3 text-sm text-stone-500">This screen has no hidden tests configured.</p>
      )}
      {state === 'error' && (
        <p className="mt-3 rounded-lg bg-flag-50 px-3 py-2 text-sm text-flag-700 ring-1 ring-flag-100">
          {error}
        </p>
      )}
      {/* Structured per-case screens (LeetCode-style): show each case. */}
      {state === 'done' && result && result.kind === 'cases' && (
        <TestCaseResults result={result} className="mt-4" />
      )}

      {state === 'done' && result && result.kind !== 'cases' && (
        <div className="mt-4">
          <div
            className={`flex items-center gap-3 rounded-xl border px-4 py-3 ${
              result.passed ? 'border-clay-200 bg-clay-50' : 'border-amber-200 bg-amber-50'
            }`}
          >
            <span
              className={`grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white ring-1 ${
                result.passed ? 'text-clay-600 ring-clay-200' : 'text-amber-600 ring-amber-200'
              }`}
            >
              {result.passed ? <Check size={16} /> : <span className="text-sm font-semibold">✕</span>}
            </span>
            <div>
              <p className="text-sm font-semibold text-ink">
                {result.passed ? 'All tests passed' : 'Tests failed'}
                {result.total ? ` · ${result.passedCount}/${result.total}` : ''}
              </p>
              <p className="text-xs text-stone-500">
                exit {result.exitCode} · {result.durationMs}ms
              </p>
            </div>
          </div>
          {(result.stderr || result.stdout) && (
            <pre className="mt-3 max-h-48 overflow-auto rounded-xl bg-[#1F1A14] p-3 font-mono text-[11px] leading-relaxed text-stone-200">
              {(result.stdout || '') + (result.stderr ? `\n${result.stderr}` : '')}
            </pre>
          )}
        </div>
      )}

      {/* Delta vs one-shot AI — where the human beat the agent on the same tests. */}
      {state === 'done' && (
        <div className="mt-4 border-t border-stone-200 pt-4">
          {bState !== 'done' && (
            <button onClick={runBaseline} disabled={bState === 'running'} className="btn-quiet text-sm">
              {bState === 'running' ? 'Comparing to one-shot AI…' : 'Compare to one-shot AI'}
            </button>
          )}
          {bState === 'na' && (
            <p className="mt-1 text-xs text-stone-500">No one-shot baseline available for this screen.</p>
          )}
          {bState === 'error' && (
            <p className="mt-1 text-xs text-flag-700">Couldn't compute the baseline.</p>
          )}
          {bState === 'done' && baseline && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-stone-400">
                Candidate vs one-shot AI
              </p>
              <div className="mt-2 flex items-center gap-3 text-sm">
                <span className="rounded-lg bg-clay-50 px-3 py-1.5 font-medium text-clay-800">
                  Candidate {baseline.candidate.passed}/{baseline.candidate.total}
                </span>
                <span className="text-stone-400">vs</span>
                <span className="rounded-lg bg-stone-100 px-3 py-1.5 font-medium text-stone-700">
                  One-shot AI {baseline.baseline.passed}/{baseline.baseline.total}
                </span>
              </div>
              <p className="mt-2 text-sm text-stone-600">
                {baseline.delta > 0
                  ? `The human passed ${baseline.delta} test${baseline.delta === 1 ? '' : 's'} the agent's one-shot attempt missed.`
                  : baseline.delta === 0
                    ? 'Matched the agent’s one-shot attempt on the hidden tests.'
                    : 'The one-shot agent passed more of the hidden tests here.'}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
