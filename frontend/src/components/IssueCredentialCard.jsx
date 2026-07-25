import { useState } from 'react'
import { api } from '../services/api.js'
import { ShieldCheck, Check, Link as LinkIcon } from './icons.jsx'

// Mint a shareable, publicly verifiable credential for a scored submission.
// POST /credentials/submissions/:id/issue returns { public_token, verify_url, ... }.
// We surface the resulting verify_url so the recruiter can share proof that does
// not require the recipient to sign in.
//
// Props:
//   submissionId — required to issue the credential.
export default function IssueCredentialCard({ submissionId }) {
  const [issuing, setIssuing] = useState(false)
  const [credential, setCredential] = useState(null)
  const [error, setError] = useState(null)
  const [copied, setCopied] = useState(false)

  // Prefer the server-provided verify_url; otherwise build the public path from
  // the public_token so the link is always shareable.
  const verifyUrl =
    credential?.verify_url ||
    (credential?.public_token
      ? `${window.location.origin}/verify/${credential.public_token}`
      : null)

  async function issue() {
    if (!submissionId) return
    setIssuing(true)
    setError(null)
    try {
      const res = await api.issueCredential(submissionId)
      setCredential(res)
    } catch (e) {
      setError(e?.message || 'Could not issue a verified credential.')
    } finally {
      setIssuing(false)
    }
  }

  async function copyLink() {
    if (!verifyUrl) return
    try {
      await navigator.clipboard?.writeText(verifyUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      /* Clipboard can be blocked; the URL is shown for manual copy. */
    }
  }

  return (
    <div className="card p-5">
      <h3 className="inline-flex items-center gap-2 font-serif text-base font-semibold text-ink">
        <ShieldCheck size={16} className="text-clay-500" /> Verified credential
      </h3>
      <p className="mt-2 text-xs leading-relaxed text-stone-500">
        Issue a tamper-evident, publicly verifiable record of this score — shareable with anyone,
        no sign-in required to verify.
      </p>

      {!credential ? (
        <>
          <button
            onClick={issue}
            disabled={!submissionId || issuing}
            className="btn-primary mt-3 w-full px-4 py-2.5 text-xs disabled:opacity-60"
          >
            <ShieldCheck size={15} /> {issuing ? 'Issuing…' : 'Issue verified credential'}
          </button>
          {error && (
            <p className="mt-3 rounded-lg bg-flag-50 px-3 py-2 text-xs text-flag-700 ring-1 ring-flag-100">
              {error}
            </p>
          )}
        </>
      ) : (
        <div className="mt-3 space-y-2">
          <p className="inline-flex items-center gap-1.5 text-xs font-medium text-clay-700">
            <Check size={14} /> Credential issued
          </p>
          {verifyUrl && (
            <>
              <div className="break-all rounded-lg border border-stone-200 bg-canvas/60 px-3 py-2 font-mono text-[11px] text-stone-600">
                {verifyUrl}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={copyLink}
                  className="btn-ghost flex-1 justify-center px-3 py-2 text-xs"
                >
                  <LinkIcon size={14} /> {copied ? 'Copied' : 'Copy verify link'}
                </button>
                <a
                  href={verifyUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn-ghost flex-1 justify-center px-3 py-2 text-xs"
                >
                  Open
                </a>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
