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

// Synthesize a single line of narration to an mp3 file.
async function synthOne(text, voice, filepath) {
  const tts = new MsEdgeTTS();
  await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
  const { audioStream } = await tts.toStream(text);

  await new Promise((resolve, reject) => {
    const out = fs.createWriteStream(filepath);
    audioStream.on('data', (chunk) => out.write(chunk));
    audioStream.on('end', () => out.end());
    audioStream.on('error', reject);
    out.on('finish', resolve);
    out.on('error', reject);
  });

  try { tts.close(); } catch {}
}

/**
 * Generate one voiceover clip per beat.
 * @param {Array<{narration:string}>} beats
 * @param {string} voiceKey  - female_energetic | male_deep | female_calm
 * @param {string} outDir
 * @returns {Promise<Array<{index, filepath, duration}>>}
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
      await synthOne(text, voice, filepath);
      const duration = await probeDuration(filepath);
      clips.push({ index: i, filepath, duration: duration || 2.5 });
      console.log(`[TTS] Beat ${i}: ${duration.toFixed(2)}s — "${text.slice(0, 50)}"`);
    } catch (e) {
      console.log(`[TTS] Beat ${i} failed: ${e.message}`);
      // Fail soft: a silent placeholder so the slide still shows
      clips.push({ index: i, filepath: null, duration: 2.5 });
    }
  }
  return clips;
}

module.exports = { synthesizeBeats, probeDuration, VOICE_MAP };
