// ── TALKING-HEAD AVATAR (swappable plug-in) ───────────────────────────────────
// The video engine treats the avatar as an OPTIONAL corner overlay. This keeps the
// whole pipeline 100% free today (mode 'none') while leaving a clean slot to wire
// in a renderer that needs an NVIDIA GPU — which this machine lacks locally.
//
//   none  → no avatar. Pure faceless reel (TTS + captions + b-roll). Works now.
//   colab → POST narration audio + a face image to a Google Colab notebook running
//           an open-source model (SadTalker / Wav2Lip) on a free T4, get a webm back.
//   did   → call the D-ID / HeyGen free-tier API (limited credits, reliable quality).
//
// Mode is chosen via env: AVATAR_MODE (default 'none').
// Each renderer returns a path to a transparent/croppable video clip, or null.

const MODE = (process.env.AVATAR_MODE || 'none').toLowerCase();

async function renderNone() {
  return null;
}

async function renderColab(/* { audioPath, faceImage, outDir } */) {
  // TODO: ship audio+face to a Colab endpoint (e.g. ngrok/Gradio URL in COLAB_AVATAR_URL),
  // poll for the rendered clip, download it. Returns local clip path.
  console.log('[Avatar] mode=colab not wired yet — falling back to no avatar.');
  return null;
}

async function renderDid(/* { audioPath, faceImage, outDir } */) {
  // TODO: D-ID/HeyGen talks API using DID_API_KEY. Returns downloaded clip path.
  console.log('[Avatar] mode=did not wired yet — falling back to no avatar.');
  return null;
}

/**
 * Produce an avatar overlay clip for the full narration, or null if disabled.
 * @param {{ audioPath?: string, faceImage?: string, outDir: string }} opts
 * @returns {Promise<string|null>} path to overlay video, or null
 */
async function renderAvatar(opts = {}) {
  switch (MODE) {
    case 'colab': return renderColab(opts);
    case 'did':   return renderDid(opts);
    case 'none':
    default:      return renderNone(opts);
  }
}

module.exports = { renderAvatar, AVATAR_MODE: MODE };
