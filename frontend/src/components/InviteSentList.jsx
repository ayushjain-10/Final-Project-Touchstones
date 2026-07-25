// Persistent "Sent to" confirmations for the candidate-invite flow. Each send
// this session appends an entry, so the recruiter always sees everyone they
// just invited. Uses the clay success treatment from the design system.
//
//   invites: [{ email, emailSent, link }]
//     emailSent true  -> the invite email went out.
//     emailSent false -> the invite is recorded but delivery failed; we surface
//                        the candidate link so the recruiter can share it directly.

import { Check } from './icons.jsx'

export function InviteSentList({ invites }) {
  if (!invites || invites.length === 0) return null
  return (
    <ul className="mt-3 space-y-2">
      {invites.map((inv, i) => (
        <li
          key={`${inv.email}-${i}`}
          className="rounded-lg border border-clay-200 bg-white px-3 py-2.5"
        >
          <p className="flex items-center gap-1.5 text-xs font-semibold text-clay-800">
            <Check size={13} className="shrink-0 text-clay-600" /> Sent to {inv.email}
          </p>
          {inv.emailSent ? (
            <p className="mt-0.5 text-[0.7rem] text-stone-500">Invite emailed.</p>
          ) : (
            <>
              <p className="mt-0.5 text-[0.7rem] leading-relaxed text-stone-600">
                Invite recorded, email delivery failed, share the link directly:
              </p>
              {inv.link && (
                <input
                  readOnly
                  value={inv.link}
                  onFocus={(e) => e.target.select()}
                  className="mt-1.5 w-full rounded-md border border-stone-200 bg-paper px-2 py-1.5 font-mono text-[0.7rem] text-ink outline-none"
                />
              )}
            </>
          )}
        </li>
      ))}
    </ul>
  )
}
