// record-demo.mjs — records the "Watch it work" product-demo video for the home page.
//
// DEV-ONLY TOOL. requires: npm i -D playwright  (dev-only, NOT a build dependency —
// do NOT add it to package.json/package-lock.json; Vercel installs devDeps at build
// time and a committed playwright dep would pull browsers on every deploy). Install it
// temporarily (or into a scratch dir and point NODE_PATH at it), run this, then remove it.
// The only things that ship are the produced mp4 asset and this script.
//
// What it does: drives the PUBLIC polished routes on the live site (no auth) — the home
// hero, then /sample-report (the real result card, rubric, why-this-score, proof-of-human),
// then /candidate (the "AI is allowed" transparency notice + the real task/editor) — with
// deliberate, slow pacing, records a webm via Playwright, then encodes to a compact mp4.
//
// Usage:
//   npm i -D playwright && npx playwright install chromium
//   node frontend/scripts/record-demo.mjs
//   # optional overrides:
//   DEMO_BASE_URL=https://touchstone-app.vercel.app node frontend/scripts/record-demo.mjs
//
// Output: frontend/public/demos/demo.mp4  (wire it up with VITE_DEMO_VIDEO_URL=/demos/demo.mp4)

import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'

// createRequire uses CommonJS resolution, which honours NODE_PATH — so this resolves
// playwright whether it's installed in frontend/node_modules or a scratch dir on NODE_PATH.
const require = createRequire(import.meta.url)
const { chromium } = require('playwright')

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const BASE = (process.env.DEMO_BASE_URL || 'https://touchstone-app.vercel.app').replace(/\/$/, '')
const OUT_MP4 = path.resolve(__dirname, '../public/demos/demo.mp4')
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-demo-'))
const W = 1280
const H = 720

// easeInOutQuad smooth-scroll to an absolute Y over `ms` — runs in the page.
async function smoothScrollTo(page, targetY, ms = 2200) {
  await page.evaluate(
    ({ targetY, ms }) =>
      new Promise((resolve) => {
        const startY = window.scrollY
        const dist = targetY - startY
        const start = performance.now()
        const ease = (t) => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t)
        function step(now) {
          const t = Math.min(1, (now - start) / ms)
          window.scrollTo(0, startY + dist * ease(t))
          if (t < 1) requestAnimationFrame(step)
          else resolve()
        }
        requestAnimationFrame(step)
      }),
    { targetY, ms },
  )
}

// Absolute Y of the first visible heading/section whose text contains `text`.
async function findY(page, text) {
  return page.evaluate((needle) => {
    const els = [...document.querySelectorAll('h1,h2,h3,h4')]
    const el = els.find(
      (e) => e.offsetParent !== null && e.textContent.toLowerCase().includes(needle.toLowerCase()),
    )
    return el ? Math.max(0, el.getBoundingClientRect().top + window.scrollY) : null
  }, text)
}

async function goto(page, url) {
  await page.goto(url, { waitUntil: 'networkidle' })
  await page.evaluate(() => (document.fonts ? document.fonts.ready : null)).catch(() => {})
  await page.waitForTimeout(900)
}

const hold = (page, ms) => page.waitForTimeout(ms)

async function main() {
  const browser = await chromium.launch()
  const context = await browser.newContext({
    viewport: { width: W, height: H },
    deviceScaleFactor: 1,
    recordVideo: { dir: WORK, size: { width: W, height: H } },
  })
  // Suppress the cookie-consent banner so it never covers a shot (declines tracking).
  await context.addInitScript(() => {
    try {
      localStorage.setItem('ts_cookie_consent', 'declined')
    } catch {
      /* storage blocked — banner may show; harmless */
    }
  })

  const page = await context.newPage()

  // 1) Home hero — the thesis.
  await goto(page, `${BASE}/`)
  await hold(page, 3200)

  // 2) Scroll to the real result card ("One card tells you everything") — the product as proof.
  const cardY = (await findY(page, 'One card tells you everything')) ?? 2600
  await smoothScrollTo(page, cardY - 90, 2600)
  await hold(page, 2800)

  // 3) Sample report — the real reviewer view.
  await goto(page, `${BASE}/sample-report`)
  await hold(page, 3400) // recommendation card: score, "Strong — advance", the three signals
  const whyY = (await findY(page, 'why this score')) ?? 1300
  await smoothScrollTo(page, whyY - 120, 3000) // rubric criteria + reasoning
  await hold(page, 2600)
  const proofY = (await findY(page, 'proof of human')) ?? 1900
  await smoothScrollTo(page, proofY - 120, 2400) // proof-of-human + audit trail
  await hold(page, 2800)

  // 4) Candidate screen — AI-allowed, transparent.
  await goto(page, `${BASE}/candidate`)
  await hold(page, 1200)
  await hold(page, 4200) // transparency banner + task + editor + "Direct the AI"

  // 5) Bookend back on the hero.
  await goto(page, `${BASE}/`)
  await hold(page, 2400)

  // Finalize the webm.
  const video = page.video()
  await context.close()
  await browser.close()
  const webm = await video.path()

  // Encode to a compact, web-friendly mp4.
  fs.mkdirSync(path.dirname(OUT_MP4), { recursive: true })
  execFileSync(
    'ffmpeg',
    [
      '-y',
      '-i', webm,
      '-vf', `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,fps=30`,
      '-c:v', 'libx264',
      '-crf', '26',
      '-preset', 'veryfast',
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      '-an',
      OUT_MP4,
    ],
    { stdio: 'inherit' },
  )
  fs.rmSync(WORK, { recursive: true, force: true })

  const bytes = fs.statSync(OUT_MP4).size
  console.log(`\n✓ wrote ${OUT_MP4} (${(bytes / 1e6).toFixed(2)} MB)`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
