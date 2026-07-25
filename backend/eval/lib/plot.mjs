/**
 * plot.mjs — dependency-free SVG charts + a seeded RNG for the offline eval harnesses.
 * ------------------------------------------------------------------------------------
 * No numpy/matplotlib on the box, so we render publication-ready SVG by hand and embed it
 * straight into the HTML report (printed to PDF via headless Chrome). Colors follow the
 * Touchstones terracotta/ink design system (no green). Everything here is pure + deterministic
 * so the paper's figures are exactly reproducible from a fixed seed.
 */
import fs from 'node:fs';
import path from 'node:path';

// ── Palette: neutral academic (blue primary, slate baseline, red flag). Deliberately NOT the
// product's terracotta so the paper/deck figures read as a plain report, not brand collateral.
// Key names are kept for stability; the values are what changed.
export const COLORS = {
  ink: '#111827', // near-black (axis emphasis, reference lines, value labels)
  clay: '#1F4E8C', // PRIMARY blue (shrinkage estimate / blind scorer / "good")
  brick: '#B42318', // red (flagged / adverse impact)
  sand: '#94A3B8', // steel/slate (secondary bar series)
  gray: '#64748B', // slate-gray (raw/baseline line)
  grid: '#E5E7EB', // light gray gridlines
  axis: '#475569', // slate axis + tick labels
  paper: '#FFFFFF',
};

// Deterministic PRNG (mulberry32) — same seed → same figures/numbers, every run.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Draw a Binomial(n, p) sample from a uniform rng (sum of Bernoulli trials — exact, n is small).
export function binomial(n, p, rng) {
  let k = 0;
  for (let i = 0; i < n; i += 1) if (rng() < p) k += 1;
  return k;
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ── Multi-line chart. series: [{label,color,points:[[x,y],...],dashed?}].  `domain` (ordered x
// values) gives EVENLY-spaced ordinal x positions — cleaner than a linear axis when small x values
// cluster (e.g. N = 0,2,4,6,8,…). Without `domain`, x is a linear numeric axis. ──
export function lineChart({
  series, title, xlabel, ylabel, width = 880, height = 420,
  yMin = 0, yMax = 100, domain, note,
}) {
  const m = { l: 66, r: 232, t: 48, b: 74 };
  const iw = width - m.l - m.r;
  const ih = height - m.t - m.b;
  let sx;
  let ticksX;
  if (domain && domain.length) {
    const idx = new Map(domain.map((v, i) => [v, i]));
    sx = (x) => m.l + (iw * (idx.get(x) ?? 0)) / (domain.length - 1 || 1);
    ticksX = domain;
  } else {
    const xs = series.flatMap((s) => s.points.map((p) => p[0]));
    const xMin = Math.min(...xs);
    const xMax = Math.max(...xs);
    sx = (x) => m.l + (iw * (x - xMin)) / (xMax - xMin || 1);
    ticksX = xs.filter((v, i, a) => a.indexOf(v) === i).sort((a, b) => a - b);
  }
  const sy = (y) => m.t + ih - (ih * (y - yMin)) / (yMax - yMin || 1);
  const yStep = (yMax - yMin) / 5;

  let g = '';
  for (let i = 0; i <= 5; i += 1) {
    const yv = yMin + i * yStep;
    const y = sy(yv);
    g += `<line x1="${m.l}" y1="${y}" x2="${m.l + iw}" y2="${y}" stroke="${COLORS.grid}" stroke-width="1"/>`;
    g += `<text x="${m.l - 10}" y="${y + 4}" text-anchor="end" font-size="12" fill="${COLORS.axis}">${Math.round(yv)}</text>`;
  }
  for (const xv of ticksX) {
    const x = sx(xv);
    g += `<line x1="${x}" y1="${m.t + ih}" x2="${x}" y2="${m.t + ih + 5}" stroke="${COLORS.axis}" stroke-width="1"/>`;
    g += `<text x="${x}" y="${m.t + ih + 20}" text-anchor="middle" font-size="12" fill="${COLORS.axis}">${xv}</text>`;
  }
  series.forEach((s) => {
    const d = s.points.map((p, i) => `${i ? 'L' : 'M'}${sx(p[0]).toFixed(1)},${sy(p[1]).toFixed(1)}`).join(' ');
    g += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2.5" ${s.dashed ? 'stroke-dasharray="6 4"' : ''}/>`;
    s.points.forEach((p) => {
      g += `<circle cx="${sx(p[0]).toFixed(1)}" cy="${sy(p[1]).toFixed(1)}" r="3.2" fill="${s.color}"/>`;
    });
  });
  series.forEach((s, i) => {
    const ly = m.t + 8 + i * 24;
    g += `<line x1="${m.l + iw + 16}" y1="${ly}" x2="${m.l + iw + 44}" y2="${ly}" stroke="${s.color}" stroke-width="3" ${s.dashed ? 'stroke-dasharray="6 4"' : ''}/>`;
    g += `<text x="${m.l + iw + 50}" y="${ly + 4}" font-size="12.5" fill="${COLORS.ink}">${esc(s.label)}</text>`;
  });
  g += `<line x1="${m.l}" y1="${m.t + ih}" x2="${m.l + iw}" y2="${m.t + ih}" stroke="${COLORS.axis}" stroke-width="1.5"/>`;
  g += `<line x1="${m.l}" y1="${m.t}" x2="${m.l}" y2="${m.t + ih}" stroke="${COLORS.axis}" stroke-width="1.5"/>`;
  g += `<text x="${m.l}" y="28" font-size="16" font-weight="700" fill="${COLORS.ink}">${esc(title)}</text>`;
  g += `<text x="${m.l + iw / 2}" y="${m.t + ih + 42}" text-anchor="middle" font-size="13" fill="${COLORS.axis}">${esc(xlabel)}</text>`;
  g += `<text transform="translate(16,${m.t + ih / 2}) rotate(-90)" text-anchor="middle" font-size="13" fill="${COLORS.axis}">${esc(ylabel)}</text>`;
  if (note) g += `<text x="${m.l}" y="${height - 8}" font-size="11" fill="${COLORS.gray}">${esc(note)}</text>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" font-family="system-ui,-apple-system,Segoe UI,Roboto,sans-serif" style="background:${COLORS.paper}">${g}</svg>`;
}

// ── Grouped bar chart. groups: [{label, bars:[{series,value,flagged?}]}], refLine optional ──
export function barChart({
  groups, seriesColors, title, ylabel, width = 880, height = 420,
  yMax = 1.2, refLine, refLabel, note,
}) {
  const m = { l: 66, r: 232, t: 48, b: 66 };
  const iw = width - m.l - m.r;
  const ih = height - m.t - m.b;
  const sy = (y) => m.t + ih - (ih * y) / yMax;
  const gW = iw / groups.length;
  const seriesNames = Object.keys(seriesColors);
  const barW = Math.min(46, (gW * 0.7) / seriesNames.length);

  let g = '';
  for (let i = 0; i <= 6; i += 1) {
    const yv = (yMax / 6) * i;
    const y = sy(yv);
    g += `<line x1="${m.l}" y1="${y}" x2="${m.l + iw}" y2="${y}" stroke="${COLORS.grid}" stroke-width="1"/>`;
    g += `<text x="${m.l - 10}" y="${y + 4}" text-anchor="end" font-size="12" fill="${COLORS.axis}">${yv.toFixed(1)}</text>`;
  }
  groups.forEach((grp, gi) => {
    const cx = m.l + gi * gW + gW / 2;
    const total = grp.bars.length;
    grp.bars.forEach((bar, bi) => {
      const bx = cx - (total * barW) / 2 + bi * barW + barW * 0.1;
      const val = Math.min(yMax, bar.value == null ? 0 : bar.value);
      const y = sy(val);
      const color = bar.flagged ? COLORS.brick : seriesColors[bar.series];
      g += `<rect x="${bx.toFixed(1)}" y="${y.toFixed(1)}" width="${(barW * 0.8).toFixed(1)}" height="${(m.t + ih - y).toFixed(1)}" fill="${color}" rx="2"/>`;
      if (bar.value != null) {
        g += `<text x="${(bx + barW * 0.4).toFixed(1)}" y="${(y - 5).toFixed(1)}" text-anchor="middle" font-size="10.5" fill="${COLORS.ink}">${bar.value.toFixed(2)}</text>`;
      }
    });
    g += `<text x="${cx}" y="${m.t + ih + 18}" text-anchor="middle" font-size="12" fill="${COLORS.axis}">${esc(grp.label)}</text>`;
  });
  if (refLine != null) {
    const y = sy(refLine);
    g += `<line x1="${m.l}" y1="${y}" x2="${m.l + iw}" y2="${y}" stroke="${COLORS.ink}" stroke-width="1.5" stroke-dasharray="7 4"/>`;
    if (refLabel) g += `<text x="${m.l + iw}" y="${y - 6}" text-anchor="end" font-size="11.5" font-weight="600" fill="${COLORS.ink}">${esc(refLabel)}</text>`;
  }
  // legend
  seriesNames.forEach((sName, i) => {
    const ly = m.t + 6 + i * 22;
    g += `<rect x="${m.l + iw + 14}" y="${ly - 9}" width="16" height="12" fill="${seriesColors[sName]}" rx="2"/>`;
    g += `<text x="${m.l + iw + 36}" y="${ly + 1}" font-size="12" fill="${COLORS.ink}">${esc(sName)}</text>`;
  });
  const flaggedIdx = seriesNames.length;
  g += `<rect x="${m.l + iw + 14}" y="${m.t + 6 + flaggedIdx * 22 - 9}" width="16" height="12" fill="${COLORS.brick}" rx="2"/>`;
  g += `<text x="${m.l + iw + 36}" y="${m.t + 6 + flaggedIdx * 22 + 1}" font-size="12" fill="${COLORS.ink}">flagged (&lt; 0.80)</text>`;

  g += `<line x1="${m.l}" y1="${m.t + ih}" x2="${m.l + iw}" y2="${m.t + ih}" stroke="${COLORS.axis}" stroke-width="1.5"/>`;
  g += `<line x1="${m.l}" y1="${m.t}" x2="${m.l}" y2="${m.t + ih}" stroke="${COLORS.axis}" stroke-width="1.5"/>`;
  g += `<text x="${m.l}" y="26" font-size="16" font-weight="700" fill="${COLORS.ink}">${esc(title)}</text>`;
  g += `<text transform="translate(16,${m.t + ih / 2}) rotate(-90)" text-anchor="middle" font-size="13" fill="${COLORS.axis}">${esc(ylabel)}</text>`;
  if (note) g += `<text x="${m.l}" y="${height - 12}" font-size="11" fill="${COLORS.gray}">${esc(note)}</text>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" font-family="system-ui,-apple-system,Segoe UI,Roboto,sans-serif" style="background:${COLORS.paper}">${g}</svg>`;
}

export function saveSvg(outDir, name, svg) {
  fs.mkdirSync(outDir, { recursive: true });
  const p = path.join(outDir, name);
  fs.writeFileSync(p, svg);
  return p;
}

export function saveJson(outDir, name, obj) {
  fs.mkdirSync(outDir, { recursive: true });
  const p = path.join(outDir, name);
  fs.writeFileSync(p, JSON.stringify(obj, null, 2));
  return p;
}
