const sharp = require('sharp');
const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');

const { synthesizeBeats } = require('./tts');
const { renderAvatar, AVATAR_MODE } = require('./avatarRenderer');

const REELS_DIR = path.join(__dirname, '../temp/reels');
if (!fs.existsSync(REELS_DIR)) fs.mkdirSync(REELS_DIR, { recursive: true });

const AVATARS_DIR = path.join(__dirname, '../assets/avatars');

// ── VERTICAL CANVAS (Reels / Shorts / TikTok) ─────────────────────────────────
const W = 1080, H = 1920;
const PAD = 72;
const FPS = 30;

// Brand (mirrors imageComposer.js — cyan accent, DEVELOPSCHL)
const ACCENT = '#00e5ff';
const WHITE  = '#ffffff';
const BLACK  = '#000000';
const FONT   = 'Arial Black,Arial,sans-serif';
const FONT_B = 'Arial,sans-serif';

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

// ── FRAME (one beat card) ─────────────────────────────────────────────────────
function buildFrameSvg(beat, idx, total, badge, imgBase64) {
  const onscreen  = (beat.onscreen || beat.text || '').toUpperCase();
  const narration = beat.narration || '';
  const isHook    = idx === 0;
  const isCta     = idx === total - 1;

  // Background: photo + heavy gradient, else animated-looking dark gradient
  const bg = imgBase64
    ? `<image href="data:image/jpeg;base64,${imgBase64}" x="0" y="0" width="${W}" height="${H}"
         preserveAspectRatio="xMidYMid slice"/>
       <rect width="${W}" height="${H}" fill="url(#shade)"/>`
    : `<rect width="${W}" height="${H}" fill="#06070d"/>
       <circle cx="${W * 0.5}" cy="${H * 0.34}" r="620" fill="url(#glow)"/>
       <rect width="${W}" height="${H}" fill="url(#shade)"/>`;

  // Big on-screen headline — adaptive size, centered band
  const len = onscreen.length;
  const SIZE = len <= 14 ? 132 : len <= 26 ? 104 : len <= 40 ? 84 : 68;
  const LH   = Math.round(SIZE * 1.08);
  const MAXC = len <= 14 ? 9 : len <= 26 ? 12 : 15;
  const lines = wrap(onscreen, MAXC).slice(0, 4);
  const blockH = lines.length * LH;
  const startY = Math.round(H * 0.42 - blockH / 2) + SIZE;

  const headSvg = lines.map((line, i) => {
    const y = startY + i * LH;
    return `<text x="${W / 2}" y="${y}" font-family="${FONT}" font-size="${SIZE}"
      font-weight="900" fill="${WHITE}" text-anchor="middle"
      stroke="rgba(0,0,0,0.55)" stroke-width="3" paint-order="stroke"
      letter-spacing="-1">${esc(line)}</text>`;
  }).join('\n');

  // Accent underline bar under the headline (energy)
  const barY = startY + (lines.length - 1) * LH + 38;
  const barSvg = `<rect x="${W / 2 - 90}" y="${barY}" width="180" height="12" rx="6" fill="${ACCENT}"/>`;

  // Narration as muted-view subtitle near the bottom
  const subLines = wrap(narration, 34).slice(0, 3);
  const SUB_SIZE = 38, SUB_LH = 50;
  const subStartY = H - 250 - (subLines.length - 1) * SUB_LH;
  const subSvg = subLines.map((line, i) =>
    `<text x="${W / 2}" y="${subStartY + i * SUB_LH}" font-family="${FONT_B}" font-size="${SUB_SIZE}"
      font-weight="600" fill="rgba(255,255,255,0.92)" text-anchor="middle"
      stroke="rgba(0,0,0,0.5)" stroke-width="2" paint-order="stroke">${esc(line)}</text>`
  ).join('\n');

  // Badge pill (top center)
  const badgeTxt = (badge || 'AI').toUpperCase();
  const badgeW = badgeTxt.length * 19 + 56;
  const badgeSvg = `
    <rect x="${W / 2 - badgeW / 2}" y="120" width="${badgeW}" height="60" rx="30" fill="${ACCENT}"/>
    <text x="${W / 2}" y="160" font-family="${FONT}" font-size="26" font-weight="900"
      fill="${BLACK}" text-anchor="middle" letter-spacing="3">${esc(badgeTxt)}</text>`;

  // Progress dots
  const dotGap = 30, dotsW = (total - 1) * dotGap;
  const dotsSvg = Array.from({ length: total }, (_, i) => {
    const cx = W / 2 - dotsW / 2 + i * dotGap;
    const on = i === idx;
    return `<circle cx="${cx}" cy="218" r="${on ? 8 : 5}" fill="${on ? ACCENT : 'rgba(255,255,255,0.4)'}"/>`;
  }).join('');

  // Bottom bar: handle + CTA
  const barBottom = `
    <text x="${PAD}" y="${H - 70}" font-family="${FONT_B}" font-size="30" font-weight="700"
      fill="rgba(255,255,255,0.85)" letter-spacing="1">@developschl</text>
    <text x="${W - PAD}" y="${H - 70}" font-family="${FONT_B}" font-size="30" font-weight="700"
      fill="${ACCENT}" text-anchor="end">${isCta ? 'Follow + Save →' : 'AI tools daily →'}</text>`;

  return `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <radialGradient id="glow" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="rgba(0,229,255,0.35)"/>
      <stop offset="100%" stop-color="rgba(0,229,255,0)"/>
    </radialGradient>
    <linearGradient id="shade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%"   stop-color="rgba(0,0,0,0.55)"/>
      <stop offset="38%"  stop-color="rgba(0,0,0,0.30)"/>
      <stop offset="72%"  stop-color="rgba(0,0,0,0.62)"/>
      <stop offset="100%" stop-color="rgba(0,0,0,0.92)"/>
    </linearGradient>
  </defs>
  ${bg}
  ${badgeSvg}
  ${dotsSvg}
  ${headSvg}
  ${barSvg}
  ${subSvg}
  ${barBottom}
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
  // Ken Burns: scale up first (anti-jitter), then slow zoom across the clip.
  const z = zoomIn
    ? `min(1+0.10*on/${frames},1.10)`
    : `max(1.10-0.10*on/${frames},1.0)`;
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

// Full-frame intro card: host photo + dark gradient + big title.
function buildIntroFrameSvg(title, imgBase64) {
  const lines = wrap(String(title).toUpperCase(), 14).slice(0, 3);
  const SIZE = 100, LH = 112;
  const blockH = lines.length * LH;
  const startY = H - 360 - blockH + SIZE;
  const titleSvg = lines.map((line, i) =>
    `<text x="${W / 2}" y="${startY + i * LH}" font-family="${FONT}" font-size="${SIZE}"
      font-weight="900" fill="${WHITE}" text-anchor="middle"
      stroke="rgba(0,0,0,0.55)" stroke-width="3" paint-order="stroke" letter-spacing="-1">${esc(line)}</text>`
  ).join('\n');

  return `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="ishade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="rgba(0,0,0,0.25)"/>
      <stop offset="50%" stop-color="rgba(0,0,0,0.30)"/>
      <stop offset="80%" stop-color="rgba(0,0,0,0.78)"/>
      <stop offset="100%" stop-color="rgba(0,0,0,0.96)"/>
    </linearGradient>
  </defs>
  <image href="data:image/jpeg;base64,${imgBase64}" x="0" y="0" width="${W}" height="${H}" preserveAspectRatio="xMidYMid slice"/>
  <rect width="${W}" height="${H}" fill="url(#ishade)"/>
  <rect x="${W / 2 - 150}" y="200" width="300" height="64" rx="32" fill="${ACCENT}"/>
  <text x="${W / 2}" y="242" font-family="${FONT}" font-size="28" font-weight="900" fill="${BLACK}" text-anchor="middle" letter-spacing="3">DEVELOPSCHL</text>
  ${titleSvg}
  <rect x="${W / 2 - 90}" y="${startY + (lines.length - 1) * LH + 40}" width="180" height="12" rx="6" fill="${ACCENT}"/>
  <text x="${W / 2}" y="${H - 70}" font-family="${FONT_B}" font-size="30" font-weight="700" fill="rgba(255,255,255,0.85)" text-anchor="middle" letter-spacing="1">@developschl</text>
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
  const backgrounds = opts.backgrounds || [];

  // 1) Voiceover per beat (free Edge TTS) → durations drive the timeline
  console.log(`[Reel] Synthesizing ${beats.length} narration clips...`);
  const clips = await synthesizeBeats(beats, script.narrationVoice, work);

  // 2) Render a frame per beat
  console.log('[Reel] Rendering frames...');
  const segPaths = [];
  let totalDur = 0;
  for (let i = 0; i < beats.length; i++) {
    const svg = buildFrameSvg(beats[i], i, beats.length, badge, backgrounds[i] || null);
    const framePath = path.join(work, `frame_${i}.png`);
    await sharp(Buffer.from(svg)).png().toFile(framePath);

    const clip = clips.find((c) => c.index === i) || { filepath: null, duration: 2.5 };
    const dur = Math.max(1.6, (clip.duration || 2.5) + 0.45); // pad so narration isn't clipped
    const segPath = path.join(work, `seg_${i}.mp4`);
    await buildSegment(framePath, clip.filepath, dur, segPath, i % 2 === 0);
    segPaths.push(segPath);
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
      const introB64 = (await sharp(intro.image)
        .resize(W, H, { fit: 'cover', position: 'top' }).jpeg({ quality: 88 }).toBuffer()).toString('base64');
      const introFrame = path.join(work, 'frame_intro.png');
      await sharp(Buffer.from(buildIntroFrameSvg(intro.text, introB64))).png().toFile(introFrame);
      const introSeg = path.join(work, 'seg_intro.mp4');
      await buildSegment(introFrame, introAudio, introDur, introSeg, true);
      segPaths.unshift(introSeg);
      totalDur += introDur;
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

module.exports = { composeReel, cleanOldReels, REELS_DIR };
