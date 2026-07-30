const sharp = require('sharp');
const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');

const { synthesizeBeats } = require('./tts');
const { renderAvatar, AVATAR_MODE } = require('./avatarRenderer');
const { buildCaptionFile } = require('./captions');

const REELS_DIR = path.join(__dirname, '../temp/reels');
if (!fs.existsSync(REELS_DIR)) fs.mkdirSync(REELS_DIR, { recursive: true });

const AVATARS_DIR = path.join(__dirname, '../assets/avatars');

// ── VERTICAL CANVAS (Reels / Shorts / TikTok) ─────────────────────────────────
const W = 1080, H = 1920;
const PAD = 72;
const FPS = 30;

// Brand comes from ../brand.js — single source of truth, shared with the carousels.
const brand = require('../brand');
const { HANDLE, WORDMARK, INK } = brand;
const FONT   = brand.FONT_DISPLAY;
const FONT_B = brand.FONT_BODY;
const WHITE  = INK.white;
const BLACK  = INK.black;

function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Word-wrap plain text to <= maxChars per line.
function wrap(text, maxChars) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = '';
  for (const w of words) {
    const candidate = cur ? cur + ' ' + w : w;
    if (candidate.length > maxChars && cur) { lines.push(cur); cur = w; }
    else cur = candidate;
  }
  if (cur) lines.push(cur);
  return lines;
}

// ── THE DEVELOPSCHL REEL TEMPLATE ─────────────────────────────────────────────
// Every frame is drawn from code — no stock photos, no scraped article images, no
// generated art. That is deliberate: a borrowed photo makes a reel look like
// everyone else's, and the whole point here is that a viewer recognises the frame
// in the first half second of a scroll.
//
// The recognisable signature, identical on every frame of every reel:
//   • an accent rail pinned to the left edge, full height
//   • the brand lockup top-left, the DAY n/100 chip top-right
//   • left-aligned display type (almost every competitor centres over a photo)
//   • narration in a "terminal" card with an accent left border
//   • an accent progress bar showing how far through the reel you are
//
// Layout stays inside brand.SAFE so Instagram's own UI never covers the words.

const GEO = {
  rail: 14,          // left accent rail width
  lockupY: 262,      // brand lockup band
  lockupH: 62,
  contentTop: 520,   // the band the eyebrow + headline + card are centred within
  contentBottom: 1470,
  captionTop: 1150,  // top of the burned-in caption band (keep headlines above it)
  progressY: 1548,
  handleY: 1620,
};

// Burned-in captions are positioned by ASS as a bottom margin, so derive it from
// captionTop to keep the two layouts from drifting apart.
const CAPTION_MARGIN_V = H - GEO.captionTop - 190;

// Shared background: near-black, coarse blueprint grid, one accent bloom.
// The grid is deliberately coarse (90px) and faint — a fine grid shimmers badly
// once FFmpeg's Ken Burns zoom scales the frame.
function chromeDefs(accent) {
  return `
    <pattern id="grid" width="90" height="90" patternUnits="userSpaceOnUse">
      <path d="M90 0H0V90" fill="none" stroke="rgba(255,255,255,0.085)" stroke-width="1.5"/>
    </pattern>
    <radialGradient id="bloom" cx="18%" cy="26%" r="62%">
      <stop offset="0%"   stop-color="${accent}" stop-opacity="0.20"/>
      <stop offset="100%" stop-color="${accent}" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="railGrad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%"   stop-color="${accent}" stop-opacity="1"/>
      <stop offset="70%"  stop-color="${accent}" stop-opacity="0.85"/>
      <stop offset="100%" stop-color="${accent}" stop-opacity="0.25"/>
    </linearGradient>
    <linearGradient id="floor" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%"   stop-color="rgba(0,0,0,0)"/>
      <stop offset="100%" stop-color="rgba(0,0,0,0.55)"/>
    </linearGradient>`;
}

function chromeBackground(accent) {
  return `
    <rect width="${W}" height="${H}" fill="${INK.base}"/>
    <rect width="${W}" height="${H}" fill="url(#grid)"/>
    <rect width="${W}" height="${H}" fill="url(#bloom)"/>
    <rect x="0" y="${H * 0.6}" width="${W}" height="${H * 0.4}" fill="url(#floor)"/>
    <rect x="0" y="0" width="${GEO.rail}" height="${H}" fill="url(#railGrad)"/>`;
}

// Top-left: accent tile + wordmark. The tile is the mark people learn to spot.
function brandLockup(accent) {
  const x = brand.SAFE.left;
  const y = GEO.lockupY;
  const s = GEO.lockupH;
  return `
    <rect x="${x}" y="${y}" width="${s}" height="${s}" rx="16" fill="${accent}"/>
    <text x="${x + s / 2}" y="${y + s * 0.71}" font-family="${FONT}" font-size="34"
      font-weight="900" fill="${BLACK}" text-anchor="middle" letter-spacing="-1">D/</text>
    <text x="${x + s + 22}" y="${y + s * 0.68}" font-family="${FONT}" font-size="33"
      font-weight="900" fill="${WHITE}" letter-spacing="3.5">${esc(WORDMARK)}</text>`;
}

// Top-right: the challenge counter, e.g. "DAY 3/100". Outline pill so it reads as
// metadata rather than competing with the accent lockup.
function dayChip(badge, accent) {
  const label = String(badge || '').toUpperCase().trim();
  if (!label) return '';
  const w = label.length * 18 + 52;
  const x = W - brand.SAFE.right - w;
  const y = GEO.lockupY;
  return `
    <rect x="${x}" y="${y}" width="${w}" height="${GEO.lockupH}" rx="${GEO.lockupH / 2}"
      fill="rgba(255,255,255,0.06)" stroke="${accent}" stroke-width="2"/>
    <text x="${x + w / 2}" y="${y + GEO.lockupH * 0.67}" font-family="${FONT}" font-size="25"
      font-weight="900" fill="${accent}" text-anchor="middle" letter-spacing="2.5">${esc(label)}</text>`;
}

// Bottom: progress through the reel + handle. Gives a reason to keep watching.
function footer(idx, total, accent) {
  const x = brand.SAFE.left;
  const w = W - brand.SAFE.left - brand.SAFE.right;
  const done = total > 1 ? (idx + 1) / total : 1;
  return `
    <rect x="${x}" y="${GEO.progressY}" width="${w}" height="6" rx="3" fill="rgba(255,255,255,0.14)"/>
    <rect x="${x}" y="${GEO.progressY}" width="${Math.round(w * done)}" height="6" rx="3" fill="${accent}"/>
    <text x="${x}" y="${GEO.handleY}" font-family="${FONT_B}" font-size="30" font-weight="700"
      fill="${INK.muted}" letter-spacing="1.5">${esc(HANDLE)}</text>
    <text x="${W - brand.SAFE.right}" y="${GEO.handleY}" font-family="${FONT_B}" font-size="30"
      font-weight="700" fill="${accent}" text-anchor="end">${idx + 1}/${total}</text>`;
}

// ── FRAME (one beat card) ─────────────────────────────────────────────────────
// `opts.captions` = word-synced captions will be burned in over this frame, so the
// static narration card is dropped (the captions say the same words, live) and the
// headline is lifted clear of the caption band instead of being centred into it.
function buildFrameSvg(beat, idx, total, badge, themeName, opts = {}) {
  const theme = brand.getTheme(themeName || 'ai');
  const accent = theme.accent;
  const onscreen = (beat.onscreen || beat.text || '').toUpperCase();
  const narration = opts.captions ? '' : (beat.narration || '');
  const isCta = idx === total - 1;

  // Eyebrow above the headline: step number mid-reel, a call to action at the end.
  const eyebrow = isCta ? 'FOLLOW FOR DAILY AI TOOLS'
    : idx === 0 ? theme.label
    : `STEP ${idx} OF ${total - 1}`;

  // Headline — left-aligned, sized down as it gets longer so it always fits.
  const len = onscreen.length;
  const SIZE = len <= 14 ? 126 : len <= 26 ? 104 : len <= 44 ? 84 : 68;
  const LH = Math.round(SIZE * 1.06);
  const MAXC = len <= 14 ? 11 : len <= 26 ? 14 : 17;
  const lines = wrap(onscreen, MAXC).slice(0, 4);
  const x = brand.SAFE.left;

  const subLines = wrap(narration, 36).slice(0, 3);
  const SUB_LH = 50;
  const cardH = subLines.length ? subLines.length * SUB_LH + 56 : 0;
  const cardW = W - brand.SAFE.left - brand.SAFE.right;

  // Lay the block out as a flow, then centre the whole thing in the content band.
  // SVG text is positioned by BASELINE, so every gap here has to be measured
  // against cap height — using raw line-height left the eyebrow sitting on top of
  // the headline's capitals, and made the block measure shorter than it looks.
  const EYEBROW_SIZE = 27;
  const CAP = SIZE * 0.72;                    // cap height above the baseline
  const GAP_EYEBROW = 46, GAP_RULE = 42, RULE_H = 10, GAP_CARD = 58;

  const headVisualH = CAP + (lines.length - 1) * LH;
  const blockH = EYEBROW_SIZE + GAP_EYEBROW + headVisualH + GAP_RULE + RULE_H
    + (cardH ? GAP_CARD + cardH : 0);

  // With burned-in captions the headline has to end above the caption band, so the
  // usable band shortens and the block sits high in it rather than centred low.
  const bandBottom = opts.captions ? GEO.captionTop - 40 : GEO.contentBottom;
  const band = bandBottom - GEO.contentTop;
  // 0.58 rather than 0.5 — a slight downward bias reads better in a vertical feed
  // and keeps the headline clear of the thumb-scroll zone at the very top.
  const bias = opts.captions ? 0.35 : 0.58;
  const visualTop = GEO.contentTop + Math.max(0, Math.round((band - blockH) * bias));

  let cursor = visualTop + EYEBROW_SIZE;
  const eyebrowSvg = `
    <rect x="${x}" y="${cursor - 6}" width="42" height="6" rx="3" fill="${accent}"/>
    <text x="${x + 60}" y="${cursor}" font-family="${FONT}" font-size="${EYEBROW_SIZE}"
      font-weight="900" fill="${accent}" letter-spacing="4">${esc(eyebrow)}</text>`;

  cursor += GAP_EYEBROW + CAP;                // first headline baseline
  const headSvg = lines.map((line, i) =>
    `<text x="${x}" y="${cursor + i * LH}" font-family="${FONT}" font-size="${SIZE}"
      font-weight="900" fill="${WHITE}" letter-spacing="-2">${esc(line)}</text>`
  ).join('\n');

  cursor += (lines.length - 1) * LH + GAP_RULE;
  const ruleSvg = `<rect x="${x}" y="${cursor}" width="132" height="${RULE_H}" rx="5" fill="${accent}"/>`;

  // Narration card — the "terminal" motif, and doubles as subtitles for the large
  // majority of viewers watching muted.
  cursor += RULE_H + GAP_CARD;
  const cardTop = cursor;
  const subSvg = subLines.length ? `
    <rect x="${x}" y="${cardTop}" width="${cardW}" height="${cardH}" rx="20"
      fill="rgba(14,16,24,0.88)" stroke="${INK.hairline}" stroke-width="1.5"/>
    <rect x="${x}" y="${cardTop}" width="6" height="${cardH}" rx="3" fill="${accent}"/>
    ${subLines.map((line, i) =>
      `<text x="${x + 34}" y="${cardTop + 44 + i * SUB_LH}" font-family="${FONT_B}"
        font-size="34" font-weight="600" fill="rgba(255,255,255,0.93)">${esc(line)}</text>`
    ).join('\n')}` : '';

  return `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>${chromeDefs(accent)}</defs>
  ${chromeBackground(accent)}
  ${brandLockup(accent)}
  ${dayChip(badge, accent)}
  ${eyebrowSvg}
  ${headSvg}
  ${ruleSvg}
  ${subSvg}
  ${footer(idx, total, accent)}
</svg>`;
}

// ── FFMPEG HELPERS ────────────────────────────────────────────────────────────
function ffmpeg(args) {
  return new Promise((resolve, reject) => {
    execFile('ffmpeg', args, { maxBuffer: 1024 * 1024 * 64 }, (err, _stdout, stderr) => {
      if (err) reject(new Error(`ffmpeg failed: ${String(stderr).slice(-600)}`));
      else resolve();
    });
  });
}

// Build one video segment: still frame held for `dur`s, with its narration (or silence).
async function buildSegment(framePath, audioPath, dur, segPath, zoomIn) {
  const frames = Math.max(1, Math.round(dur * FPS));
  // Gentle drift, not a photo Ken Burns. The frames are vector-rendered now, and
  // the old 10% zoom made the background grid and the type edges crawl; 3.5% keeps
  // the frame alive without visible shimmer.
  const z = zoomIn
    ? `min(1+0.035*on/${frames},1.035)`
    : `max(1.035-0.035*on/${frames},1.0)`;
  const vf = `scale=1620:2880,zoompan=z='${z}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${W}x${H}:fps=${FPS},format=yuv420p`;

  const args = ['-y', '-loop', '1', '-framerate', String(FPS), '-i', framePath];
  if (audioPath) args.push('-i', audioPath);
  else args.push('-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100');

  args.push(
    '-vf', vf,
    '-map', '0:v', '-map', '1:a',
    '-t', dur.toFixed(2),
    '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '128k', '-ar', '44100',
    '-r', String(FPS),
    segPath
  );
  await ffmpeg(args);
}

// ── HOST AVATAR (static presenter overlay, no GPU) ────────────────────────────
// Resolve which avatar image to use. `host` ∈ boy | girl | auto | none.
// 'auto' matches the narration voice gender.
function resolveHostImage(host, narrationVoice) {
  if (host === 'none') return null;
  let which = host;
  if (!which || which === 'auto') {
    which = String(narrationVoice || '').startsWith('male') ? 'boy' : 'girl';
  }
  for (const ext of ['png', 'jpg', 'jpeg', 'webp']) {
    const p = path.join(AVATARS_DIR, `${which}.${ext}`);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

// Crop avatar to a circle with a cyan brand ring → transparent PNG.
async function buildHostBadge(srcPath, outPath, size = 240, ring = 8) {
  const circleMask = Buffer.from(
    `<svg width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="#fff"/></svg>`
  );
  const ringSvg = Buffer.from(
    `<svg width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2 - ring / 2}" fill="none" stroke="${ACCENT}" stroke-width="${ring}"/></svg>`
  );
  const avatar = await sharp(srcPath).resize(size, size, { fit: 'cover', position: 'top' }).png().toBuffer();
  const circled = await sharp(avatar).composite([{ input: circleMask, blend: 'dest-in' }]).png().toBuffer();
  await sharp(circled).composite([{ input: ringSvg }]).png().toFile(outPath);
}

// ── BRANDED INTRO STING (static host, no GPU) ─────────────────────────────────
// Resolve intro config from assets/intro.json (so "every reel starts the same"),
// overridable per-request via opts.intro.
function resolveIntro(optsIntro) {
  if (optsIntro === false) return null;
  let cfg = {};
  const cfgPath = path.join(__dirname, '../assets/intro.json');
  if (fs.existsSync(cfgPath)) {
    try { cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8')); } catch {}
  }
  if (optsIntro && typeof optsIntro === 'object') cfg = { ...cfg, ...optsIntro };
  if (cfg.enabled === false) return null;

  // Resolve image (default host.png in avatars dir)
  let imgPath = null;
  const imgName = cfg.image || 'host.png';
  for (const cand of [path.join(AVATARS_DIR, imgName), path.isAbsolute(imgName) ? imgName : null].filter(Boolean)) {
    if (fs.existsSync(cand)) { imgPath = cand; break; }
  }
  if (!imgPath) return null; // no host image → no intro (faceless)

  return {
    image: imgPath,
    text: cfg.text || 'AI TOOL OF THE DAY',
    narration: cfg.narration || '',
  };
}

// Intro sting — same chrome as every other frame so the brand reads instantly,
// with the host portrait as a framed circle rather than a full-bleed photo. The
// photo is the one image in the system, and it is the user's own host, not stock.
// `imgBase64` is expected to be a square crop (see composeReel).
const INTRO_HOST = { cx: W / 2, cy: 760, r: 215, ring: 10 };

function buildIntroFrameSvg(title, imgBase64, themeName) {
  const theme = brand.getTheme(themeName || 'ai');
  const accent = theme.accent;
  const { cx, cy, r, ring } = INTRO_HOST;

  const lines = wrap(String(title).toUpperCase(), 15).slice(0, 3);
  const SIZE = lines.length > 2 ? 92 : 108;
  const LH = Math.round(SIZE * 1.06);
  const startY = 1180 + SIZE * 0.8;

  const titleSvg = lines.map((line, i) =>
    `<text x="${cx}" y="${startY + i * LH}" font-family="${FONT}" font-size="${SIZE}"
      font-weight="900" fill="${WHITE}" text-anchor="middle" letter-spacing="-2">${esc(line)}</text>`
  ).join('\n');

  const hostSvg = imgBase64 ? `
    <circle cx="${cx}" cy="${cy}" r="${r + 26}" fill="${accent}" opacity="0.12"/>
    <image href="data:image/jpeg;base64,${imgBase64}"
      x="${cx - r}" y="${cy - r}" width="${r * 2}" height="${r * 2}"
      preserveAspectRatio="xMidYMid slice" clip-path="url(#hostClip)"/>
    <circle cx="${cx}" cy="${cy}" r="${r - ring / 2}" fill="none" stroke="${accent}" stroke-width="${ring}"/>` : '';

  const ruleY = startY + (lines.length - 1) * LH + 46;

  return `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    ${chromeDefs(accent)}
    <clipPath id="hostClip"><circle cx="${cx}" cy="${cy}" r="${r}"/></clipPath>
  </defs>
  ${chromeBackground(accent)}
  ${brandLockup(accent)}
  ${hostSvg}
  ${titleSvg}
  <rect x="${cx - 66}" y="${ruleY}" width="132" height="10" rx="5" fill="${accent}"/>
  <text x="${cx}" y="${GEO.handleY}" font-family="${FONT_B}" font-size="30" font-weight="700"
    fill="${INK.muted}" text-anchor="middle" letter-spacing="1.5">${esc(HANDLE)}</text>
</svg>`;
}

/**
 * Compose a full vertical reel from a script.
 * @param {Object} script  - from generateReelScript(): { beats, badge?, narrationVoice, ... }
 * @param {Object} [opts]  - { backgrounds?: string[] (base64 per beat), faceImage?: string }
 * @returns {Promise<{ filename, filepath, durationSec, beats }>}
 */
async function composeReel(script, opts = {}) {
  const stamp = Date.now();
  const work = path.join(REELS_DIR, `work_${stamp}`);
  fs.mkdirSync(work, { recursive: true });

  const beats = script.beats;
  const badge = script.badge || 'AI TOOL';
  // Which brand pillar this reel belongs to → drives the accent colour.
  const themeName = opts.theme || script.theme || 'ai';

  // 1) Voiceover per beat (free Edge TTS) → durations drive the timeline
  console.log(`[Reel] Synthesizing ${beats.length} narration clips...`);
  const clips = await synthesizeBeats(beats, script.narrationVoice, work);

  // Word-synced captions are on by default — they are the defining element of the
  // format, and the timings come free from the TTS metadata.
  const wantCaptions = opts.captions !== false;

  // 2) Render a frame per beat
  console.log('[Reel] Rendering frames...');
  const segPaths = [];
  const captionSegments = [];
  let totalDur = 0;
  for (let i = 0; i < beats.length; i++) {
    const svg = buildFrameSvg(beats[i], i, beats.length, badge, themeName, { captions: wantCaptions });
    const framePath = path.join(work, `frame_${i}.png`);
    await sharp(Buffer.from(svg)).png().toFile(framePath);

    const clip = clips.find((c) => c.index === i) || { filepath: null, duration: 2.5 };
    const dur = Math.max(1.6, (clip.duration || 2.5) + 0.45); // pad so narration isn't clipped
    const segPath = path.join(work, `seg_${i}.mp4`);
    await buildSegment(framePath, clip.filepath, dur, segPath, i % 2 === 0);
    segPaths.push(segPath);
    // Record where this beat lands in the finished video so captions line up.
    captionSegments.push({ words: clip.words || [], offset: totalDur });
    totalDur += dur;
    console.log(`[Reel] Segment ${i} → ${dur.toFixed(2)}s`);
  }

  // 2b) Optional branded intro sting (host photo + title), prepended
  const intro = resolveIntro(opts.intro);
  if (intro) {
    try {
      let introDur = 1.8, introAudio = null;
      if (intro.narration) {
        const [clip] = await synthesizeBeats([{ narration: intro.narration }], script.narrationVoice, work);
        if (clip) { introAudio = clip.filepath; introDur = Math.max(1.6, (clip.duration || 1.8) + 0.4); }
      }
      // Square crop — the intro frames the host in a circle, not full-bleed.
      const side = INTRO_HOST.r * 2;
      const introB64 = (await sharp(intro.image)
        .resize(side, side, { fit: 'cover', position: 'top' }).jpeg({ quality: 90 }).toBuffer()).toString('base64');
      const introFrame = path.join(work, 'frame_intro.png');
      await sharp(Buffer.from(buildIntroFrameSvg(intro.text, introB64, themeName))).png().toFile(introFrame);
      const introSeg = path.join(work, 'seg_intro.mp4');
      await buildSegment(introFrame, introAudio, introDur, introSeg, true);
      segPaths.unshift(introSeg);
      totalDur += introDur;
      // The intro goes in FRONT, so every beat now starts introDur later than it
      // did when its caption offset was recorded. Without this the captions run
      // ahead of the voice by the length of the intro.
      for (const seg of captionSegments) seg.offset += introDur;
      console.log(`[Reel] Intro sting prepended (${introDur.toFixed(2)}s, ${path.basename(intro.image)})`);
    } catch (e) {
      console.log(`[Reel] Intro skipped: ${e.message}`);
    }
  }

  // 3) Concatenate segments
  const listPath = path.join(work, 'concat.txt');
  fs.writeFileSync(listPath, segPaths.map((p) => `file '${p.replace(/\\/g, '/')}'`).join('\n'));
  let outName = `reel_${stamp}.mp4`;
  let outPath = path.join(REELS_DIR, outName);
  console.log('[Reel] Concatenating segments...');
  await ffmpeg([
    '-y', '-f', 'concat', '-safe', '0', '-i', listPath,
    '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart',
    outPath,
  ]);

  // 3b) Burn word-synced captions. Done after concat so one libass pass covers the
  // whole timeline; doing it per segment would re-encode every clip twice.
  if (wantCaptions) {
    try {
      const assPath = buildCaptionFile(captionSegments, {
        themeName,
        playResX: W, playResY: H,
        marginV: CAPTION_MARGIN_V,
        outPath: path.join(work, 'captions.ass'),
      });
      if (assPath) {
        const withCaps = path.join(REELS_DIR, `reel_${stamp}_cap.mp4`);
        // libass needs a POSIX-ish path and ':' escaped, or the filter arg splits.
        const filterPath = assPath.replace(/\\/g, '/').replace(/:/g, '\\:');
        await ffmpeg([
          '-y', '-i', outPath, '-vf', `ass='${filterPath}'`,
          '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p',
          '-c:a', 'copy', '-movflags', '+faststart', withCaps,
        ]);
        try { fs.rmSync(outPath, { force: true }); } catch {}
        outName = path.basename(withCaps);
        outPath = withCaps;
        const total = captionSegments.reduce((n, s) => n + (s.words?.length || 0), 0);
        console.log(`[Reel] Captions burned in (${total} words word-synced)`);
      } else {
        console.log('[Reel] No word timings available — captions skipped');
      }
    } catch (e) {
      // Never lose a finished reel over captions.
      console.log(`[Reel] Captions skipped: ${e.message}`);
    }
  }

  // 4a) Static host avatar overlay (upper-right, subtle bob) — free, no GPU
  const hostImage = resolveHostImage(opts.host || 'auto', script.narrationVoice);
  if (hostImage) {
    try {
      const badgePath = path.join(REELS_DIR, `host_${stamp}.png`);
      await buildHostBadge(hostImage, badgePath);
      const withHost = path.join(REELS_DIR, `reel_${stamp}_host.mp4`);
      // Bob vertically ~±8px on a 2.5s cycle so the static face feels alive.
      await ffmpeg([
        '-y', '-i', outPath, '-i', badgePath,
        '-filter_complex', `[0:v][1:v]overlay=x=W-w-44:y='248+8*sin(2*PI*t/2.5)'[v]`,
        '-map', '[v]', '-map', '0:a', '-c:v', 'libx264', '-preset', 'veryfast',
        '-pix_fmt', 'yuv420p', '-c:a', 'copy', '-movflags', '+faststart', withHost,
      ]);
      try { fs.rmSync(outPath, { force: true }); fs.rmSync(badgePath, { force: true }); } catch {}
      outName = path.basename(withHost);
      outPath = withHost;
      console.log(`[Reel] Host avatar overlaid (${path.basename(hostImage)})`);
    } catch (e) {
      console.log(`[Reel] Host overlay skipped: ${e.message}`);
    }
  }

  // 4b) Optional talking-head overlay (none by default → skipped)
  if (AVATAR_MODE !== 'none') {
    try {
      const avatarPath = await renderAvatar({ outDir: work, faceImage: opts.faceImage });
      if (avatarPath) {
        const withAvatar = path.join(REELS_DIR, `reel_${stamp}_avatar.mp4`);
        await ffmpeg([
          '-y', '-i', outPath, '-i', avatarPath,
          '-filter_complex', `[1:v]scale=360:-1[av];[0:v][av]overlay=W-w-40:H-h-260[v]`,
          '-map', '[v]', '-map', '0:a', '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
          '-c:a', 'copy', withAvatar,
        ]);
        outName = path.basename(withAvatar);
        outPath = withAvatar;
      }
    } catch (e) {
      console.log(`[Reel] Avatar overlay skipped: ${e.message}`);
    }
  }

  // 5) Cleanup intermediate work dir, keep the final mp4
  try { fs.rmSync(work, { recursive: true, force: true }); } catch {}

  console.log(`[Reel] ✓ ${outName} (${totalDur.toFixed(1)}s, avatar=${AVATAR_MODE})`);
  return { filename: outName, filepath: outPath, durationSec: Math.round(totalDur), beats: beats.length };
}

function cleanOldReels() {
  const cutoff = Date.now() - 6 * 60 * 60 * 1000; // keep 6h
  try {
    fs.readdirSync(REELS_DIR).forEach((f) => {
      const fp = path.join(REELS_DIR, f);
      try { if (fs.statSync(fp).mtimeMs < cutoff) fs.rmSync(fp, { recursive: true, force: true }); } catch {}
    });
  } catch {}
}

module.exports = {
  composeReel, cleanOldReels, REELS_DIR,
  // Exported so the template can be previewed (and eyeballed) without paying for
  // a full TTS + FFmpeg render.
  buildFrameSvg, buildIntroFrameSvg,
};
