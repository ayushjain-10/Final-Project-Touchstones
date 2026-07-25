import { useCallback, useEffect, useState } from 'react'
import { api } from '../../services/api.js'
import { ShieldCheck, Check, ArrowRight } from '../../components/icons.jsx'
import { PortalSkeleton, PortalEmpty, PortalError } from '../../components/portal/PortalStates.jsx'
import { formatDate } from '../../lib/portalFormat.js'
import CandidatePortalPage from '../../components/candidate/CandidatePortalPage.jsx'

const EDITORIAL_UI_ENABLED = import.meta.env.VITE_EDITORIAL_UI_ENABLED === 'true'

// Candidate portal credentials. Each is an issued, shareable record with a public verification
// page. Verification confirms the record itself, not the candidate's identity.
function CredentialCard({ cred, editorial = false, index = 0 }) {
  const s = cred.screen || {}
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(cred.verify_url || '')
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      /* Clipboard blocked. The public record link is still available. */
    }
  }

  if (editorial) {
    return (
      <article className="grid border border-stone-200 bg-white/90 shadow-card transition duration-200 hover:border-brand-300 sm:grid-cols-[4.6rem_1fr]">
        <div className="border-b border-stone-200 bg-stone-50 px-4 py-4 sm:border-b-0 sm:border-r">
          <p className="font-mono text-lg font-semibold tabular-nums text-brand-700">
            {String(index + 1).padStart(2, '0')}
          </p>
          <p className="mt-1 font-mono text-[0.58rem] uppercase tracking-[0.15em] text-stone-400">
            Credential
          </p>
        </div>

        <div className="p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex min-w-0 items-start gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-brand-200 bg-brand-50 text-brand-600">
                <ShieldCheck size={19} />
              </span>
              <div className="min-w-0">
                <p className="font-mono text-[0.62rem] font-semibold uppercase tracking-[0.14em] text-success-700">
                  Issued record
                </p>
                <h2 className="mt-2 font-sans text-lg font-semibold text-ink">
                  {s.title || 'Credential'}
                </h2>
                <p className="mt-1 text-sm text-stone-600">
                  {s.company ? <span className="font-medium text-stone-700">{s.company}</span> : 'Touchstones'}
                  {cred.issued_at && (
                    <span className="text-stone-400"> · Issued {formatDate(cred.issued_at)}</span>
                  )}
                </p>
              </div>
            </div>

            {typeof cred.score === 'number' && (
              <div className="shrink-0 border-l border-stone-200 pl-4 text-right">
                <p className="font-mono text-2xl font-semibold tabular-nums text-brand-700">{cred.score}</p>
                <p className="text-[0.65rem] text-stone-400">score / 100</p>
              </div>
            )}
          </div>

          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-stone-200 pt-4">
            <p className="max-w-lg text-xs leading-relaxed text-stone-500">
              The public page confirms that this record was issued. It does not verify identity.
            </p>
            <div className="flex flex-wrap gap-2">
              <a
                href={cred.verify_url || '#'}
                target="_blank"
                rel="noreferrer"
                className="btn-primary inline-flex px-4 py-2 text-sm"
              >
                Open record <ArrowRight size={15} />
              </a>
              <button
                type="button"
                onClick={copy}
                className="inline-flex items-center gap-1.5 rounded-lg border border-stone-300 bg-white px-4 py-2 text-sm font-semibold text-stone-700 transition-colors hover:border-brand-300 hover:text-brand-700"
              >
                {copied ? (
                  <>
                    <Check size={15} className="text-success-600" /> Copied
                  </>
                ) : (
                  'Copy link'
                )}
              </button>
            </div>
          </div>
        </div>
      </article>
    )
  }

  return (
    <div className="rounded-2xl border border-stone-200 bg-canvas/60 p-5 dark:border-[#25304D] dark:bg-[#0D1426]">
      <div className="flex items-start gap-4">
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-clay-50 text-clay-600 ring-1 ring-clay-200 dark:bg-clay-500/10 dark:text-[#9DA9EF] dark:ring-clay-500/30">
          <ShieldCheck size={22} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-medium text-ink dark:text-[#F4F6FF]">{s.title || 'Issued credential'}</p>
          <p className="mt-0.5 text-sm text-stone-600 dark:text-[#AEB7D0]">
            {s.company ? <span className="font-medium">{s.company}</span> : 'Touchstones'}
            {cred.issued_at && <span className="text-stone-400 dark:text-[#8490AE]"> · Issued {formatDate(cred.issued_at)}</span>}
          </p>
          {typeof cred.score === 'number' && (
            <p className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-stone-200 bg-white px-2.5 py-1 text-xs font-medium tabular-nums text-ink dark:border-[#25304D] dark:bg-[#090E1C] dark:text-[#F4F6FF]">
              Score {cred.score}
              <span className="font-normal text-stone-400">/ 100</span>
            </p>
          )}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <a
          href={cred.verify_url || '#'}
          target="_blank"
          rel="noreferrer"
          className="btn-primary inline-flex px-4 py-2 text-sm"
        >
          Verify <ArrowRight size={15} />
        </a>
        <button
          type="button"
          onClick={copy}
          className="inline-flex items-center gap-1.5 rounded-xl border border-stone-200 bg-white px-4 py-2 text-sm font-medium text-stone-700 transition-colors hover:border-clay-300 dark:border-[#25304D] dark:bg-[#090E1C] dark:text-[#DDE2FF] dark:hover:border-clay-500/50"
        >
          {copied ? (
            <>
              <Check size={15} className="text-clay-500" /> Copied
            </>
          ) : (
            'Copy link'
          )}
        </button>
      </div>
    </div>
  )
}

export default function Credentials() {
  const [creds, setCreds] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const load = useCallback(() => {
    setLoading(true)
    setError(null)
    api
      .getMyCredentials()
      .then((res) => setCreds(res?.credentials || []))
      .catch((err) => setError(err))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const isEmpty = !loading && !error && (creds || []).length === 0

  if (EDITORIAL_UI_ENABLED) {
    const credentialCount = (creds || []).length

    return (
      <CandidatePortalPage
        label="Candidate record / issued credentials"
        title="Carry an issued work record with you."
        description="Each credential has a public page that confirms the record was issued by Touchstones. Share the link when it is useful, without giving someone access to your private workspace."
        asideTitle="What verification means"
        asideItems={[
          {
            title: 'Record authenticity',
            body: 'Verification confirms that the credential record was issued by Touchstones.',
          },
          {
            title: 'Candidate-controlled sharing',
            body: 'You decide where and when to share the public link.',
          },
          {
            title: 'No identity matching',
            body: 'The public page verifies the record itself, not a person through biometric matching.',
          },
        ]}
      >
        <section className="mt-8 flex flex-wrap items-center justify-between gap-4 border-y border-stone-300 bg-white/65 px-5 py-4 backdrop-blur-sm">
          <div>
            <p className="font-mono text-[0.66rem] font-semibold uppercase tracking-[0.16em] text-stone-500">
              Credential register
            </p>
            <p className="mt-1 text-sm text-stone-600">
              Public links expose the issued record, not this private portal.
            </p>
          </div>
          <div className="text-right">
            <p className="font-mono text-2xl font-semibold tabular-nums text-brand-700">{credentialCount}</p>
            <p className="text-xs text-stone-500">{credentialCount === 1 ? 'credential' : 'credentials'}</p>
          </div>
        </section>

        {loading && <PortalSkeleton count={2} />}
        {error && <PortalError error={error} onRetry={load} />}

        {isEmpty && (
          <section className="mt-8 grid gap-6 border border-dashed border-brand-300 bg-white/70 px-6 py-8 sm:grid-cols-[auto_1fr] sm:items-center">
            <span className="grid h-12 w-12 place-items-center rounded-full border border-brand-200 bg-brand-50 text-brand-600">
              <ShieldCheck size={22} />
            </span>
            <div>
              <h2 className="font-sans text-xl font-semibold text-ink">No issued credentials yet</h2>
              <p className="mt-2 max-w-xl text-sm leading-relaxed text-stone-600">
                If a company issues a credential for completed work, it will appear here with a public
                record link you can open or copy.
              </p>
            </div>
          </section>
        )}

        {!loading && !error && !isEmpty && (
          <div className="mt-8 space-y-3">
            {creds.map((credential, index) => (
              <CredentialCard key={credential.id} cred={credential} editorial index={index} />
            ))}
          </div>
        )}
      </CandidatePortalPage>
    )
  }

  return (
    <div className="mx-auto max-w-2xl px-5 py-12">
      <h1 className="font-serif text-3xl font-semibold text-ink dark:text-[#F4F6FF]">Credentials</h1>
      <p className="mt-2 text-stone-600 dark:text-[#AEB7D0]">
        Shareable records issued for completed work. Anyone with the link can check the record without
        an account.
      </p>

      {loading && <PortalSkeleton count={2} />}
      {error && <PortalError error={error} onRetry={load} />}
      {isEmpty && (
        <PortalEmpty icon={ShieldCheck} title="No credentials yet">
          When a company issues you a verified credential for a screen, it’ll appear here to share.
        </PortalEmpty>
      )}

      {!loading && !error && !isEmpty && (
        <div className="mt-6 space-y-3">
          {creds.map((c) => (
            <CredentialCard key={c.id} cred={c} />
          ))}
        </div>
      )}
    </div>
  )
}
