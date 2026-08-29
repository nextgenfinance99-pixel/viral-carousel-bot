/**
 * storyComposer.js — the end-of-day Story recapping everything posted that day.
 *
 * Why a recap rather than a plain "new post is up" sticker: a Story expires in 24
 * hours, so it is the one surface where a daily-cadence account can prove it
 * actually has a daily cadence. Listing the day's posts together makes the habit
 * visible and gives the "tap through" prompt somewhere to point.
 *
 * Drawn from the same brand.js tokens as the reels and carousels, so a viewer meets
 * the same accent, wordmark and rail on every surface. A Story that looks like a
 * different account would undo the template work.
 *
 * Rendered as a PNG at 1080x1920. Stories accept images directly, so there is no
 * FFmpeg pass and no transcode wait — by far the cheapest asset the pipeline makes.
 */
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const brand = require('../brand');

const STORIES_DIR = path.join(__dirname, '../temp/stories');
if (!fs.existsSync(STORIES_DIR)) fs.mkdirSync(STORIES_DIR, { recursive: true });

const W = 1080, H = 1920;
const FONT = brand.FONT_DISPLAY;
const FONT_B = brand.FONT_BODY;

function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function wrap(text, maxChars) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = '';
  for (const w of words) {
    const cand = cur ? `${cur} ${w}` : w;
    if (cand.length > maxChars && cur) { lines.push(cur); cur = w; }
    else cur = cand;
  }
  if (cur) lines.push(cur);
  return lines;
}

// A short human label per asset kind, so internal slot names ("morning", "howto1")
// never leak to the audience.
const KIND_LABEL = {
  spotlight: 'TOOL SPOTLIGHT',
  rundown: 'DAILY RUNDOWN',
  howto: 'HOW-TO',
  update: 'AI UPDATE',
  carousel: 'CAROUSEL',
};

/**
 * Build the Story card.
 * @param {Array<{kind,title,toolName}>} items - the assets actually posted today
 * @param {{day?:number, length?:number, themeName?:string}} opts
 */
function buildStorySvg(items, opts = {}) {
  const theme = brand.getTheme(opts.themeName || 'ai');
  const accent = theme.accent;
  const x = brand.SAFE.left;
  const day = opts.day;

  // Stories get tapped through fast, and IG covers the top with the profile row and
  // the bottom with the reply bar, so everything meaningful sits in the middle band.
  const TOP = 430;

  const header = `
    <rect x="${x}" y="${TOP - 6}" width="42" height="6" rx="3" fill="${accent}"/>
    <text x="${x + 60}" y="${TOP}" font-family="${FONT}" font-size="27" font-weight="900"
      fill="${accent}" letter-spacing="4">TODAY ON DEVELOPSCHL</text>`;

  const titleY = TOP + 118;
  const dayStr = day ? String(day) : '';
  const title = `
    <text x="${x}" y="${titleY}" font-family="${FONT}" font-size="96" font-weight="900"
      fill="${brand.INK.white}" letter-spacing="-3">${day ? `DAY ${esc(dayStr)}` : 'TODAY'}</text>
    ${day && opts.length ? `<text x="${x + 250 + dayStr.length * 56}" y="${titleY}"
      font-family="${FONT}" font-size="44" font-weight="900" fill="${accent}"
      letter-spacing="-1">/${esc(String(opts.length))}</text>` : ''}`;

  // One row per posted asset — the rows are the point of the card, so they get the
  // accent chip and the most vertical room.
  const ROW_TOP = titleY + 96;
  const ROW_H = 178;
  const shown = items.slice(0, 4);
  const rows = shown.map((it, i) => {
    const y = ROW_TOP + i * ROW_H;
    const label = KIND_LABEL[it.kind] || 'NEW POST';
    // Spotlight titles read "<tool> vs <incumbent>"; the story only needs the tool.
    const headline = String(it.toolName || it.title || 'New post').replace(/\s+vs\s+.*$/i, '');
    // Two lines max. A hard slice left news headlines ending mid-clause ("...IS
    // ROTTEN TO"), which reads as a rendering bug rather than an edit, so an
    // elided line is marked as one.
    const allLines = wrap(headline.toUpperCase(), 22);
    const lines = allLines.slice(0, 2);
    if (allLines.length > 2) lines[1] = `${lines[1].replace(/[\s,;:-]+$/, '')}…`;
    return `
      <rect x="${x}" y="${y}" width="${W - brand.SAFE.left - brand.SAFE.right}" height="${ROW_H - 22}"
        rx="20" fill="rgba(14,16,24,0.85)" stroke="${brand.INK.hairline}" stroke-width="1.5"/>
      <rect x="${x}" y="${y}" width="6" height="${ROW_H - 22}" rx="3" fill="${accent}"/>
      <text x="${x + 34}" y="${y + 46}" font-family="${FONT}" font-size="22" font-weight="900"
        fill="${accent}" letter-spacing="3">${esc(label)}</text>
      ${lines.map((ln, k) =>
        `<text x="${x + 34}" y="${y + 92 + k * 44}" font-family="${FONT}" font-size="38"
          font-weight="900" fill="${brand.INK.white}" letter-spacing="-1">${esc(ln)}</text>`
      ).join('\n')}`;
  }).join('\n');

  // Only claim a count above one, and say so honestly when more were posted than fit.
  const count = items.length;
  const overflow = count > shown.length ? ` (+${count - shown.length} more)` : '';
  const countLine = count > 1
    ? `<text x="${x}" y="${ROW_TOP + shown.length * ROW_H + 46}"
        font-family="${FONT_B}" font-size="32" font-weight="700"
        fill="${brand.INK.muted}">${count} posts today${esc(overflow)}</text>`
    : '';

  const CTA_Y = 1560;
  const cta = `
    <rect x="${x}" y="${CTA_Y - 52}" width="440" height="76" rx="38" fill="${accent}"/>
    <text x="${x + 220}" y="${CTA_Y}" font-family="${FONT}" font-size="30" font-weight="900"
      fill="${brand.INK.black}" text-anchor="middle" letter-spacing="2">TAP TO WATCH →</text>
    <text x="${x}" y="${CTA_Y + 92}" font-family="${FONT_B}" font-size="30" font-weight="700"
      fill="${brand.INK.muted}" letter-spacing="1.5">${esc(brand.HANDLE)}</text>`;

  return `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <pattern id="grid" width="90" height="90" patternUnits="userSpaceOnUse">
      <path d="M90 0H0V90" fill="none" stroke="rgba(255,255,255,0.085)" stroke-width="1.5"/>
    </pattern>
    <radialGradient id="bloom" cx="18%" cy="24%" r="62%">
      <stop offset="0%" stop-color="${accent}" stop-opacity="0.22"/>
      <stop offset="100%" stop-color="${accent}" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="railGrad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${accent}" stop-opacity="1"/>
      <stop offset="100%" stop-color="${accent}" stop-opacity="0.25"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="${brand.INK.base}"/>
  <rect width="${W}" height="${H}" fill="url(#grid)"/>
  <rect width="${W}" height="${H}" fill="url(#bloom)"/>
  <rect x="0" y="0" width="14" height="${H}" fill="url(#railGrad)"/>
  <rect x="${x}" y="262" width="62" height="62" rx="16" fill="${accent}"/>
  <text x="${x + 31}" y="306" font-family="${FONT}" font-size="34" font-weight="900"
    fill="${brand.INK.black}" text-anchor="middle" letter-spacing="-1">D/</text>
  <text x="${x + 84}" y="304" font-family="${FONT}" font-size="33" font-weight="900"
    fill="${brand.INK.white}" letter-spacing="3.5">${esc(brand.WORDMARK)}</text>
  ${header}
  ${title}
  ${rows}
  ${countLine}
  ${cta}
</svg>`;
}

/**
 * Render the day's recap Story to a PNG.
 * @returns {Promise<{filepath, filename, count}|null>} null when nothing was posted
 */
async function composeStory(items, opts = {}) {
  const posted = (items || []).filter(Boolean);
  // No posts means no recap. An empty "today on DEVELOPSCHL" card is worse than
  // staying quiet, and the Story ring is the most visible thing on the profile.
  if (!posted.length) return null;

  const svg = buildStorySvg(posted, opts);
  const filename = `story_${Date.now()}.png`;
  const filepath = path.join(STORIES_DIR, filename);
  await sharp(Buffer.from(svg)).png().toFile(filepath);
  console.log(`[Story] Rendered recap of ${posted.length} post(s) -> ${filename}`);
  return { filepath, filename, count: posted.length };
}

function cleanOldStories(maxAgeMs = 24 * 60 * 60 * 1000) {
  const cutoff = Date.now() - maxAgeMs;
  try {
    for (const f of fs.readdirSync(STORIES_DIR)) {
      const fp = path.join(STORIES_DIR, f);
      try { if (fs.statSync(fp).mtimeMs < cutoff) fs.rmSync(fp, { force: true }); } catch {}
    }
  } catch {}
}

module.exports = { composeStory, buildStorySvg, cleanOldStories, STORIES_DIR };
