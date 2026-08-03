const sharp = require('sharp');
const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');

const { synthesizeBeats } = require('./tts');
const { renderAvatar, AVATAR_MODE } = require('./avatarRenderer');
const { buildCaptionFile } = require('./captions');
const { captureToolPage } = require('./screenCapture');

const REELS_DIR = path.join(__dirname, '../temp/reels');
if (!fs.existsSync(REELS_DIR)) fs.mkdirSync(REELS_DIR, { recursive: true });

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
// captionTop to keep the two layouts from drifting apart. The B-roll layout pushes
// them lower, since the footage band occupies where they would otherwise sit.
const CAPTION_MARGIN_V = H - GEO.captionTop - 190;
const CAPTION_MARGIN_V_BROLL = H - 1300 - 190;

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
    </linearGradient>
    <clipPath id="outsideBand">
      <rect x="0" y="0" width="${W}" height="${BROLL.y}"/>
      <rect x="0" y="${BROLL.y + BROLL.h}" width="${W}" height="${H - BROLL.y - BROLL.h}"/>
    </clipPath>`;
}

// The B-roll band. When a clip is available the frame leaves this area EMPTY (fully
// transparent) and FFmpeg lays the footage in underneath, so one PNG serves as both
// the chrome and the mask. An accent hairline frames the footage so it reads as a
// deliberate window rather than a video pasted on top.
// y starts BELOW the lockup band (which ends at lockupY + lockupH = 324). The first
// version began at 232 and put the wordmark and the day chip on top of the footage,
// where a white page made both unreadable.
const BROLL = { x: 0, y: 356, w: W, h: 800 };

function chromeBackground(accent, opts = {}) {
  const layers = `
    <rect width="${W}" height="${H}" fill="${INK.base}"/>
    <rect width="${W}" height="${H}" fill="url(#grid)"/>
    <rect width="${W}" height="${H}" fill="url(#bloom)"/>
    <rect x="0" y="${H * 0.6}" width="${W}" height="${H * 0.4}" fill="url(#floor)"/>`;

  const rail = `<rect x="0" y="0" width="${GEO.rail}" height="${H}" fill="url(#railGrad)"/>`;

  if (!opts.broll) return `${layers}\n    ${rail}`;

  // SVG has no "erase": painting fill="none" over an opaque background does nothing,
  // which is why the band came out solid black on the first attempt. Instead CLIP the
  // painted layers to everything OUTSIDE the band (two rects above and below it), so
  // the band is genuinely transparent and the footage shows through from underneath.
  return `
    <g clip-path="url(#outsideBand)">${layers}</g>
    <rect x="${BROLL.x}" y="${BROLL.y}" width="${BROLL.w}" height="${BROLL.h}"
      fill="none" stroke="${accent}" stroke-opacity="0.55" stroke-width="3"/>
    ${rail}`;
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

  // With B-roll the footage carries the visual and the burned-in captions carry the
  // words, so the big static headline is dropped — exactly how the reference reels
  // are built. Keeping it would also leave nowhere for it to sit: the band, the
  // headline and the caption zone cannot all fit above the footer.
  const body = opts.broll
    ? `${eyebrowUnderBand(eyebrow, accent)}`
    : `${eyebrowSvg}\n  ${headSvg}\n  ${ruleSvg}\n  ${subSvg}`;

  return `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>${chromeDefs(accent)}</defs>
  ${chromeBackground(accent, { broll: opts.broll })}
  ${brandLockup(accent)}
  ${dayChip(badge, accent)}
  ${body}
  ${footer(idx, total, accent)}
</svg>`;
}

// In the B-roll layout the only text above the captions is a small label sitting
// just under the footage, naming what the viewer is looking at.
function eyebrowUnderBand(eyebrow, accent) {
  const x = brand.SAFE.left;
  const y = BROLL.y + BROLL.h + 62;
  return `
    <rect x="${x}" y="${y - 6}" width="42" height="6" rx="3" fill="${accent}"/>
    <text x="${x + 60}" y="${y}" font-family="${FONT}" font-size="27"
      font-weight="900" fill="${accent}" letter-spacing="4">${esc(eyebrow)}</text>`;
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

/**
 * Build a segment with B-roll footage showing through the frame's transparent band.
 *
 * The frame PNG is the mask AND the chrome: the band is punched out of it, so a
 * single overlay puts the footage behind everything. The clip is scaled to cover
 * the band and looped, because a captured page clip is usually shorter than the
 * beat it has to fill.
 */
async function buildBrollSegment(framePath, brollPath, audioPath, dur, segPath) {
  const args = [
    '-y',
    '-stream_loop', '-1', '-i', brollPath,      // loop the footage to cover the beat
    '-loop', '1', '-framerate', String(FPS), '-i', framePath,
  ];
  if (audioPath) args.push('-i', audioPath);
  else args.push('-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100');

  // Scale-to-cover then centre-crop, so page footage of any aspect fills the band
  // without letterboxing or distortion. A slow drift keeps the band from feeling
  // static when the captured page happens to be still.
  // A slight knock-down on brightness/saturation: captured pages are often pure
  // white and blow out next to the near-black chrome, which makes the whole frame
  // look like two unrelated images stacked.
  const filter =
    `[0:v]scale=${BROLL.w}:${BROLL.h}:force_original_aspect_ratio=increase,` +
    `crop=${BROLL.w}:${BROLL.h},eq=brightness=-0.06:saturation=0.92,setsar=1,fps=${FPS}[bs];` +
    `color=c=${INK.base}:s=${W}x${H}:r=${FPS}[bg];` +
    `[bg][bs]overlay=${BROLL.x}:${BROLL.y}:shortest=0[withb];` +
    `[withb][1:v]overlay=0:0:format=auto,format=yuv420p[v]`;

  args.push(
    '-filter_complex', filter,
    '-map', '[v]', '-map', '2:a',
    '-t', dur.toFixed(2),
    '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '128k', '-ar', '44100',
    '-r', String(FPS),
    segPath
  );
  await ffmpeg(args);
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

/**
 * Compose a full vertical reel from a script.
 * @param {Object} script  - from generateReelScript(): { beats, badge?, narrationVoice, ... }
 * @param {Object} [opts]  - { host?, theme?, captions?: boolean }
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

  // 0) B-roll: record the tool's own page so the reel shows the real product.
  // Entirely optional — a failed or blank capture just falls back to the plain
  // template rather than costing us the reel.
  let brollClip = null;
  const brollUrl = opts.brollUrl || script.brollUrl;
  if (brollUrl && opts.broll !== false) {
    console.log(`[Reel] Capturing B-roll from ${brollUrl}`);
    brollClip = await captureToolPage(brollUrl, { seconds: 8 }).catch(() => null);
  }

  // 2) Render a frame per beat
  console.log('[Reel] Rendering frames...');
  const segPaths = [];
  const captionSegments = [];
  let totalDur = 0;
  for (let i = 0; i < beats.length; i++) {
    const svg = buildFrameSvg(beats[i], i, beats.length, badge, themeName, {
      captions: wantCaptions, broll: !!brollClip,
    });
    const framePath = path.join(work, `frame_${i}.png`);
    await sharp(Buffer.from(svg)).png().toFile(framePath);

    const clip = clips.find((c) => c.index === i) || { filepath: null, duration: 2.5 };
    const dur = Math.max(1.6, (clip.duration || 2.5) + 0.45); // pad so narration isn't clipped
    const segPath = path.join(work, `seg_${i}.mp4`);
    if (brollClip) await buildBrollSegment(framePath, brollClip, clip.filepath, dur, segPath);
    else await buildSegment(framePath, clip.filepath, dur, segPath, i % 2 === 0);
    segPaths.push(segPath);
    // Record where this beat lands in the finished video so captions line up.
    captionSegments.push({ words: clip.words || [], offset: totalDur });
    totalDur += dur;
    console.log(`[Reel] Segment ${i} → ${dur.toFixed(2)}s`);
  }

  // NOTE: there is deliberately no intro sting. Reels open straight on the hook —
  // a title card in front of it is the worst thing for retention, and the brand
  // lockup is already on the first frame and every frame after it.

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
        marginV: brollClip ? CAPTION_MARGIN_V_BROLL : CAPTION_MARGIN_V,
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

  // NOTE: no static host-photo overlay either. Removed with the intro sting.

  // 4) Optional talking-head overlay (none by default → skipped)
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
  buildFrameSvg,
};
