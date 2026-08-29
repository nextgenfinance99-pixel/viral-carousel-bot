/**
 * llm.js — which model the text pipeline talks to.
 *
 * This exists because the model id used to be hardcoded in six places across three
 * services. When Groq retired `llama-3.3-70b-versatile`, every one of them started
 * returning 404 and each caller quietly fell back to its degraded path, so drafts
 * kept being produced that looked structurally fine but had duplicated narration.
 * The pipeline was broken for weeks without saying so.
 *
 * Two rules follow from that:
 *   - one place to change the model
 *   - a missing model is a CONFIG error and must be loud, never absorbed by a
 *     fallback, because a fallback hides exactly the thing you need to see
 *
 * Groq retires models with little notice. `node -e "require('./llm').listModels()"`
 * prints what the key can currently reach.
 */

// Chosen 2026-08: the largest chat model Groq serves that honours JSON mode.
// gpt-oss-20b fails response_format validation; qwen3.8-27b works and is ~3x
// faster if throughput ever matters more than writing quality.
const CHAT_MODEL = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';

// True when an API error means "this model is gone", as opposed to a rate limit or
// a network blip. Callers should rethrow these instead of falling back.
function isModelMissing(err) {
  const code = err?.error?.error?.code || err?.code;
  const msg = String(err?.message || '');
  return err?.status === 404 || code === 'model_not_found' || /does not exist|model_not_found/i.test(msg);
}

// Rethrow a dead-model error with an actionable message; pass anything else through.
function assertModelAlive(err, where) {
  if (!isModelMissing(err)) return;
  throw new Error(
    `[${where}] Groq model "${CHAT_MODEL}" is unavailable — it was probably retired. ` +
    `Set GROQ_MODEL in backend/.env or update CHAT_MODEL in backend/llm.js. ` +
    `Run: node -e "require('./llm').listModels()" to see what your key can reach.`
  );
}

async function listModels() {
  const https = require('https');
  return new Promise((resolve) => {
    https.get(
      { host: 'api.groq.com', path: '/openai/v1/models', headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}` } },
      (r) => {
        let s = '';
        r.on('data', (d) => { s += d; });
        r.on('end', () => {
          try {
            const ids = (JSON.parse(s).data || []).map((m) => m.id).sort();
            console.log(ids.join('\n'));
            resolve(ids);
          } catch { console.log(s.slice(0, 400)); resolve([]); }
        });
      }
    ).on('error', (e) => { console.log('listModels failed:', e.message); resolve([]); });
  });
}

module.exports = { CHAT_MODEL, isModelMissing, assertModelAlive, listModels };
