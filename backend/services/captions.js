/**
 * captions.js — word-synced burned-in captions, the defining look of the
 * reference reels the user asked to match.
 *
 * The style is one or two words at a time in the centre of frame, on a dark
 * rounded plate, swapping exactly in time with the voice. That timing comes free:
 * msedge-tts exposes WordBoundary metadata (see tts.js), so we know when every
 * word is spoken without running Whisper or guessing from audio length.
 *
 * Output is an ASS subtitle file. ASS is the right target because FFmpeg's libass
 * filter burns it in one pass with real font shaping, outlines and per-event
 * positioning — far cheaper and sharper than rendering a PNG per frame.
 *
 * Everything is written in the brand's accent/type so captions read as part of
 * the template rather than bolted on.
 */
const fs = require('fs');
const path = require('path');
const brand = require('../brand');

// ASS wants &HBBGGRR (note: reversed vs hex CSS) with an alpha byte in front.
function toAssColour(hex, alpha = '00') {
  const h = String(hex).replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const r = full.slice(0, 2), g = full.slice(2, 4), b = full.slice(4, 6);
  return `&H${alpha}${b}${g}${r}`.toUpperCase();
}

function assTime(seconds) {
  const s = Math.max(0, seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  const cs = Math.round((s - Math.floor(s)) * 100);
  return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

/**
 * Group words into short caption chunks.
 *
 * Chunking (rather than one word at a time) is deliberate: single-word captions
 * on very short words like "a" or "in" flash for ~60ms, which reads as a flicker.
 * Grouping to a minimum on-screen time keeps the rhythm without losing the
 * word-synced feel.
 */
function chunkWords(words, { maxWords = 2, maxChars = 18, minSec = 0.28 } = {}) {
  const chunks = [];
  let cur = null;

  for (const w of words) {
    const wordEnd = w.start + (w.duration || 0);
    if (!cur) {
      cur = { text: w.word, start: w.start, end: wordEnd, count: 1 };
      continue;
    }
    const candidate = `${cur.text} ${w.word}`;
    const tooLong = candidate.length > maxChars || cur.count >= maxWords;
    // Keep absorbing words while the chunk is still too brief to read.
    const tooBrief = cur.end - cur.start < minSec;

    if (tooLong && !tooBrief) {
      chunks.push(cur);
      cur = { text: w.word, start: w.start, end: wordEnd, count: 1 };
    } else {
      cur.text = candidate;
      cur.end = wordEnd;
      cur.count++;
    }
  }
  if (cur) chunks.push(cur);

  // Close gaps so a chunk holds until the next one starts — otherwise the caption
  // vanishes during the natural pauses between words and looks broken.
  for (let i = 0; i < chunks.length - 1; i++) {
    chunks[i].end = Math.max(chunks[i].end, chunks[i + 1].start);
  }
  if (chunks.length) {
    const last = chunks[chunks.length - 1];
    last.end = Math.max(last.end, last.start + minSec);
  }
  return chunks;
}

// ASS escaping: braces open override blocks, and a literal newline breaks the event.
function assEscape(s) {
  return String(s)
    .replace(/\\/g, '\\\\')
    .replace(/\{/g, '(').replace(/\}/g, ')')
    .replace(/\r?\n/g, ' ');
}

/**
 * Build an ASS file for a whole reel.
 * @param {Array<{words:Array, offset:number}>} segments - per-beat word lists with
 *        the beat's start time within the finished video
 * @param {Object} opts - { themeName, fontSize, marginV, outPath, playResX, playResY }
 * @returns {string|null} path to the .ass file, or null if there was nothing to write
 */
function buildCaptionFile(segments, opts = {}) {
  const {
    themeName = 'ai',
    playResX = 1080,
    playResY = 1920,
    fontSize = 92,
    marginV = 690,      // distance up from the bottom → sits mid-frame
    outPath,
  } = opts;

  const theme = brand.getTheme(themeName);
  const events = [];

  for (const seg of segments) {
    if (!seg || !Array.isArray(seg.words) || !seg.words.length) continue;
    const offset = seg.offset || 0;
    for (const chunk of chunkWords(seg.words)) {
      const start = assTime(offset + chunk.start);
      const end = assTime(offset + chunk.end);
      // \fad gives each chunk a fast in/out so swaps feel snappy, not jumpy.
      events.push(`Dialogue: 0,${start},${end},Pop,,0,0,0,,{\\fad(60,60)}${assEscape(chunk.text.toUpperCase())}`);
    }
  }

  if (!events.length) return null;

  // BorderStyle 3 + a wide outline is what produces the filled plate behind the
  // text seen in the references (libass has no real box-with-padding primitive).
  // In ASS an alpha byte of 00 is OPAQUE and FF is transparent, so the plate
  // colour carries a low alpha to read as near-solid.
  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: ${playResX}
PlayResY: ${playResY}
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding
Style: Pop,${brand.CAPTION_FONT},${fontSize},${toAssColour(brand.INK.white)},${toAssColour(theme.accent)},${toAssColour(brand.INK.base, '0C')},${toAssColour(brand.INK.black, '00')},-1,0,0,0,100,100,2,0,3,15,0,2,60,60,${marginV},1

[Events]
Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text
`;

  const target = outPath || path.join(process.cwd(), `captions_${Date.now()}.ass`);
  fs.writeFileSync(target, header + events.join('\n') + '\n', 'utf8');
  return target;
}

module.exports = { buildCaptionFile, chunkWords, toAssColour, assTime };
