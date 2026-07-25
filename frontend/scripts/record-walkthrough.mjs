// record-walkthrough.mjs — records the cursor-driven product walkthrough to an mp4/webm.
//
// DEV-ONLY TOOL. requires: npm i -D playwright  (dev-only, NOT a build dependency — do NOT add it
// to package.json/package-lock.json; a committed playwright dep would pull browsers on every
// Vercel deploy). Install it temporarily, run this, then remove it. The only things that ship are
// the produced mp4/webm assets and this script.
//
// What it does: opens the SELF-CONTAINED animation at public/demos/walkthrough.html (a cursor
// drives the real flow: author a screen from a template, send it, the candidate solves it in the
// dark 3-pane IDE with AI assist, Run shows the tests passing, then the score card lands), plays
// exactly one loop, records a webm via Playwright, then ffmpeg trims the lead-in and encodes a
// compact, muted, loop-ready mp4.
//
// Usage (from the frontend/ directory):
//   npm i -D playwright && npx playwright install chromium
//   node scripts/record-walkthrough.mjs
//   # ffmpeg must be on PATH (macOS: `brew install ffmpeg`)
//
// Output: public/demos/walkthrough.mp4 + public/demos/walkthrough.webm
// The homepage already renders the live animation (ProductTour). To serve the mp4 instead, swap
// ProductTour's <iframe> for <video src="/demos/walkthrough.mp4" autoplay muted loop playsinline>.

import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'

// createRequire uses CommonJS resolution (honours NODE_PATH), so this resolves playwright whether
// it's in frontend/node_modules or a scratch dir on NODE_PATH.
const require = createRequire(import.meta.url)
const { chromium } = require('playwright')

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const HTML = path.resolve(__dirname, '../public/demos/walkthrough.html')
const OUT_MP4 = path.resolve(__dirname, '../public/demos/walkthrough.mp4')
const OUT_WEBM = path.resolve(__dirname, '../public/demos/walkthrough.webm')
const OUT_DIR = path.dirname(OUT_MP4)

const W = 1280
const H = 994 // keeps the 660x512 design aspect (~1.289); even for yuv420p
const LEAD_S = 0.6 // pre-start settle to trim so the mp4 opens on the first action
const LOOP_MS = 23800 // one full narrative before it repeats

async function main() {
  const browser = await chromium.launch()
  const context = await browser.newContext({
    viewport: { width: W, height: H },
    deviceScaleFactor: 2,
    recordVideo: { dir: OUT_DIR, size: { width: W, height: H } },
  })
  const page = await context.newPage()
  await page.goto('file://' + HTML, { waitUntil: 'load' })
  await page.evaluate(() => (document.fonts ? document.fonts.ready : null)).catch(() => {})
  await page.waitForTimeout(LEAD_S * 1000 + LOOP_MS + 500)

  const video = page.video()
  await context.close() // finalizes the .webm
  await browser.close()

  const raw = await video.path()
  fs.renameSync(raw, OUT_WEBM)

  execFileSync(
    'ffmpeg',
    [
      '-y',
      '-ss', String(LEAD_S),
      '-t', String(LOOP_MS / 1000),
      '-i', OUT_WEBM,
      '-vf', `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,fps=30`,
      '-c:v', 'libx264',
      '-crf', '20',
      '-preset', 'veryfast',
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      '-an',
      OUT_MP4,
    ],
    { stdio: 'inherit' },
  )

  const mb = (fs.statSync(OUT_MP4).size / 1e6).toFixed(2)
  console.log(`\n✓ wrote ${OUT_MP4} (${mb} MB)\n✓ wrote ${OUT_WEBM}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
