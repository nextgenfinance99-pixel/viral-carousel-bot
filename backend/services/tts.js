const { MsEdgeTTS, OUTPUT_FORMAT } = require('msedge-tts');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

// ── FREE VOICEOVER (Microsoft Edge neural voices, no API key) ─────────────────
// One mp3 per beat so the video can time each on-screen card to its narration.

// reelScript.js emits narrationVoice ∈ {female_energetic, male_deep, female_calm}
const VOICE_MAP = {
  female_energetic: 'en-US-AvaNeural',
  male_deep:        'en-US-AndrewNeural',
  female_calm:      'en-US-AriaNeural',
};
const DEFAULT_VOICE = 'en-US-AvaNeural';

// Probe an audio file's duration in seconds via ffprobe (ships with ffmpeg).
function probeDuration(filepath) {
  return new Promise((resolve) => {
    execFile(
      'ffprobe',
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', filepath],
      (err, stdout) => {
        if (err) return resolve(0);
        const d = parseFloat(String(stdout).trim());
        resolve(Number.isFinite(d) ? d : 0);
      }
    );
  });
}

// Pull WordBoundary events out of the metadata stream. Edge's TTS service already
// knows exactly when it speaks each word, so word-level caption timing is free —
// no Whisper pass, no alignment guesswork. Offsets are in 100-nanosecond ticks.
function parseWordBoundaries(raw) {
  const words = [];
  for (const match of String(raw).matchAll(/\{\s*"Metadata"[\s\S]*?\n\}/g)) {
    let json;
    try { json = JSON.parse(match[0]); } catch { continue; }
    for (const entry of json.Metadata || []) {
      if (entry.Type !== 'WordBoundary') continue;
      const text = entry.Data?.text?.Text;
      if (!text) continue;
      words.push({
        word: text,
        start: entry.Data.Offset / 1e7,
        duration: (entry.Data.Duration || 0) / 1e7,
      });
    }
  }
  return words.sort((a, b) => a.start - b.start);
}

// Synthesize a single line of narration to an mp3 file.
// Returns the per-word timings so captions can be cut to the voice.
async function synthOne(text, voice, filepath) {
  const tts = new MsEdgeTTS();
  await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3, {
    wordBoundaryEnabled: true,
  });
  const { audioStream, metadataStream } = await tts.toStream(text);

  let meta = '';
  if (metadataStream) metadataStream.on('data', (c) => { meta += c; });

  await new Promise((resolve, reject) => {
    const out = fs.createWriteStream(filepath);
    audioStream.on('data', (chunk) => out.write(chunk));
    audioStream.on('end', () => out.end());
    audioStream.on('error', reject);
    out.on('finish', resolve);
    out.on('error', reject);
  });

  try { tts.close(); } catch {}
  return parseWordBoundaries(meta);
}

/**
 * Generate one voiceover clip per beat.
 * @param {Array<{narration:string}>} beats
 * @param {string} voiceKey  - female_energetic | male_deep | female_calm
 * @param {string} outDir
 * @returns {Promise<Array<{index, filepath, duration, words}>>}
 *          words = [{ word, start, duration }] relative to the start of the clip
 */
async function synthesizeBeats(beats, voiceKey, outDir) {
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const voice = VOICE_MAP[voiceKey] || DEFAULT_VOICE;

  const clips = [];
  for (let i = 0; i < beats.length; i++) {
    const text = String(beats[i].narration || '').trim();
    if (!text) continue;
    const filepath = path.join(outDir, `vo_${i}.mp3`);
    try {
      const words = await synthOne(text, voice, filepath);
      const duration = await probeDuration(filepath);
      clips.push({ index: i, filepath, duration: duration || 2.5, words });
      console.log(`[TTS] Beat ${i}: ${duration.toFixed(2)}s, ${words.length} words — "${text.slice(0, 50)}"`);
    } catch (e) {
      console.log(`[TTS] Beat ${i} failed: ${e.message}`);
      // Fail soft: a silent placeholder so the slide still shows
      clips.push({ index: i, filepath: null, duration: 2.5, words: [] });
    }
  }
  return clips;
}

module.exports = { synthesizeBeats, probeDuration, parseWordBoundaries, VOICE_MAP };
