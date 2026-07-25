# Touchstone — Frontend

The full frontend for **Touchstone** — the verified real-work screening layer for engineering teams.
_Real work. Real person. Provable._

Built as a Vite + React + Tailwind scaffold so it can be extended straight into the production app.
Every page and component compiles today (`vite build` → 59 modules, clean).

## Quick start

```bash
cd frontend
npm install        # if node_modules is missing or from another OS, delete it + package-lock first
npm run dev        # http://localhost:5173
npm run build      # production build → dist/
```

> If `npm run build` ever throws `Cannot find module @rollup/rollup-*` — that is the known
> [npm optional-deps bug](https://github.com/npm/cli/issues/4828). Fix: `rm -rf node_modules package-lock.json && npm install`.

## Design system — "rustic elegance, light"

All tokens live in `tailwind.config.js`. The rules, carried from the brand docs in `../TODO/website/`:

- **One signature accent: terracotta / "clay" (`#BD5B3D`)** — used _only_ for verified states, the
  score, and the primary CTA. **No green** (Greenhouse owns it), **no blue/purple** (every competitor default).
- **Warm, light surfaces** — `paper #FAF7F1`, `sand #F1EADD`, `canvas #FCF9F3`, white cards. No dark
  slabs anywhere; even the old "dark problem strip" is a light warm band.
- **State colors:** `clay` = verified/pass · `amber #C28A2E` = pending/needs-review · `flag #9E3528`
  (oxblood) = flagged. Oxblood is kept far from terracotta so pass never reads as fail.
- **Type:** `Fraunces` (editorial serif) for headings, `Inter` (grotesque) for body — loaded via
  Google Fonts in `index.html`. Set in the `serif` / `sans` Tailwind families.
- **Motion:** subtle scroll reveals, the score ring resolving to its value, bars filling. Transform/
  opacity only, all wrapped in `prefers-reduced-motion` (see `index.css`).
- **Imagery:** the product is the hero — no stock photos. Use the `ResultCard`, data viz, and the
  verification badge as the visual language.

Token cheat-sheet (Tailwind classes): `bg-paper`, `bg-sand`, `text-ink`, `text-stone-*` (warm gray
ramp), `text-clay-*` / `bg-clay-*`, `bg-amber-*`, `bg-flag-*`, `font-serif`, `shadow-card`, `shadow-lift`.

## Routes & pages

| Route | Page | Layout |
|---|---|---|
| `/` | `pages/marketing/Home` — **signature screen #1** | Marketing |
| `/product` | `Product` — one-narrative "how it works" | Marketing |
| `/pricing` | `Pricing` — transparent tiers + benchmarks + FAQ | Marketing |
| `/resources` | `Resources` — the cheating-crisis content hub | Marketing |
| `/about` | `About` — founder story + principles | Marketing |
| `/trust` | `Trust` — what we collect / never collect, compliance | Marketing |
| `/app` | `pages/app/Dashboard` — overview + recent results | App (sidebar) |
| `/app/result` | `Result` — **signature screen #2**, the result card in context | App (sidebar) |
| `/app/author` | `Author` — **signature screen #3**, build a real-work screen | App (sidebar) |
| `/candidate` | `pages/candidate/Candidate` — the candidate experience | Candidate (standalone) |

Routing is in `src/App.jsx`. Layouts are in `src/layouts/`.

## Structure

```
frontend/
├── index.html              # fonts + root
├── tailwind.config.js      # ← design tokens (start here)
├── src/
│   ├── index.css           # base styles, .btn / .card / .reveal, motion
│   ├── App.jsx             # routes
│   ├── layouts/            # MarketingLayout · AppLayout · CandidateLayout
│   ├── components/         # design-system primitives (see below)
│   └── pages/
│       ├── marketing/      # Home, Product, Pricing, Resources, About, Trust
│       ├── app/            # Dashboard, Result, Author
│       └── candidate/      # Candidate
```

### Key components

- **`ResultCard`** — the product hero. `<ResultCard data={…} variant="compact|full" />`. Composes the
  score ring, criterion bars, verification badge, reasoning, evidence, and audit export. A shared
  `sampleResult` export drives every demo so the card looks identical across site and app.
- **`ScoreRing`**, **`CriterionBar`** — the animated 0–100 ring and rubric bars (count-up + fill on scroll).
- **`VerifiedBadge`** — `state="verified|review|flagged"` proof-of-human pill.
- **`Button`** — polymorphic (`to` = router Link, `href` = anchor, else button); `variant="primary|ghost|quiet"`.
  Keep the **one-primary-CTA-per-view** rule.
- **`primitives.jsx`** — `Container`, `Kicker`, `Pill`, `SectionHeading`, `Stat`.
- **`Reveal`** — scroll-reveal wrapper, `delay` (ms) to stagger. Respects reduced motion.
- **`icons.jsx`** — inline SVG set (no icon dependency).

### Adding a page

1. Create `src/pages/<area>/MyPage.jsx`, compose from `primitives` + `Container` + `Reveal`.
2. Register the route in `src/App.jsx` under the right layout.
3. Use only the tokens above — never hardcode hex; never reach for green/blue/purple.

## Status & next steps for the real app

- **Content is honest by design** — no fake testimonials, no `$1` price (the launch-blockers from the
  brand docs). Pricing tiers are the real proposed ones, marked indicative.
- **Wire up:** auth + Supabase data behind `AppLayout`, real form submits (the email captures and
  candidate submit are stubbed `onSubmit`/state), Slack + Ashby/Greenhouse actions.
- **Reuse:** the in-app `/app/result` card is the same component shown on the marketing site — keep
  them as one system as the product evolves.
