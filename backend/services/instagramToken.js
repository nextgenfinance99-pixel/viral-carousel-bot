/**
 * instagramToken.js — keeps the Instagram access token alive on its own.
 *
 * Instagram long-lived tokens expire after 60 days. On 2026-08-01 one expired
 * overnight and the morning's reels simply failed to publish with a bare 400 —
 * the kind of failure that silently stops a daily poster until someone notices.
 *
 * A long-lived token can be exchanged for a fresh 60-day one at any point after
 * it is 24 hours old, so refreshing on a schedule keeps it valid indefinitely.
 * The catch is that an ALREADY-expired token cannot be refreshed, so the refresh
 * has to run with plenty of margin rather than at the last minute.
 *
 * The live token is persisted to data/ig-token.json because a refresh mints a new
 * string: keeping it only in .env would mean the refreshed token is lost on
 * restart and the original expires anyway. Pasting a new token into .env still
 * wins — a token there that differs from the one we seeded from is treated as the
 * user deliberately replacing it.
 */
const fs = require('fs');
const path = require('path');
const axios = require('axios');

const DATA_DIR = path.join(__dirname, '../data');
const TOKEN_FILE = path.join(DATA_DIR, 'ig-token.json');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DAY = 24 * 60 * 60 * 1000;
// Refresh once the token is inside its final ~20 days. Well clear of expiry even
// if the machine is off for a couple of weeks, and past the 24h minimum age.
const REFRESH_WHEN_REMAINING_MS = 20 * DAY;

function readStore() {
  try { if (fs.existsSync(TOKEN_FILE)) return JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8')); } catch {}
  return null;
}

function writeStore(store) {
  fs.writeFileSync(TOKEN_FILE, JSON.stringify(store, null, 2));
}

/**
 * The token to use right now.
 * Prefers a stored (possibly refreshed) token, unless .env holds a different one,
 * which means the user pasted a replacement and it should take over.
 */
function getToken() {
  const envToken = process.env.INSTAGRAM_ACCESS_TOKEN || null;
  const store = readStore();

  if (store && store.token) {
    if (!envToken || store.seededFrom === envToken) return store.token;
    // .env changed → user replaced the token by hand. Re-seed from it.
    console.log('[IGToken] .env token differs from the stored one — adopting the new token');
    writeStore({ token: envToken, seededFrom: envToken, expiresAt: null, refreshedAt: null });
    return envToken;
  }

  if (envToken) writeStore({ token: envToken, seededFrom: envToken, expiresAt: null, refreshedAt: null });
  return envToken;
}

/**
 * Exchange the current token for a fresh 60-day one.
 * @param {boolean} force - refresh even if it is not near expiry yet
 * @returns {Promise<{refreshed:boolean, reason?:string, expiresAt?:string}>}
 */
async function refreshIfNeeded(force = false) {
  const token = getToken();
  if (!token) return { refreshed: false, reason: 'no token configured' };

  const store = readStore() || {};
  const expiresAt = store.expiresAt ? Date.parse(store.expiresAt) : null;

  if (expiresAt && expiresAt < Date.now()) {
    // Nothing can be done automatically — the API refuses to refresh a dead token.
    console.log('[IGToken] ⚠️ Token has already EXPIRED — a new one must be generated in the Meta app.');
    return { refreshed: false, reason: 'expired — manual regeneration required' };
  }

  if (!force && expiresAt && expiresAt - Date.now() > REFRESH_WHEN_REMAINING_MS) {
    const days = Math.round((expiresAt - Date.now()) / DAY);
    return { refreshed: false, reason: `still valid for ~${days} days` };
  }

  try {
    const res = await axios.get('https://graph.instagram.com/refresh_access_token', {
      params: { grant_type: 'ig_refresh_token', access_token: token },
      timeout: 15000,
    });
    const newToken = res.data?.access_token;
    const expiresIn = Number(res.data?.expires_in || 0);
    if (!newToken) return { refreshed: false, reason: 'no token in refresh response' };

    const newExpiry = new Date(Date.now() + expiresIn * 1000).toISOString();
    writeStore({
      token: newToken,
      seededFrom: process.env.INSTAGRAM_ACCESS_TOKEN || null,
      expiresAt: newExpiry,
      refreshedAt: new Date().toISOString(),
    });
    console.log(`[IGToken] ✓ Refreshed — valid until ${newExpiry.slice(0, 10)} (~${Math.round(expiresIn / 86400)} days)`);
    return { refreshed: true, expiresAt: newExpiry };
  } catch (e) {
    const detail = e.response?.data?.error?.message || e.message;
    console.log(`[IGToken] Refresh failed: ${detail}`);
    return { refreshed: false, reason: detail };
  }
}

/**
 * Report the token's health without changing anything.
 * Used on boot so an expiring token is visible in the logs long before it bites.
 */
async function checkHealth() {
  const token = getToken();
  if (!token) return { ok: false, reason: 'not configured' };
  try {
    const res = await axios.get('https://graph.instagram.com/v19.0/me', {
      params: { fields: 'id,username', access_token: token }, timeout: 12000,
    });
    const store = readStore() || {};
    const days = store.expiresAt ? Math.round((Date.parse(store.expiresAt) - Date.now()) / DAY) : null;
    console.log(`[IGToken] OK — @${res.data.username}${days !== null ? ` (expires in ~${days} days)` : ' (expiry unknown until first refresh)'}`);
    return { ok: true, username: res.data.username, daysLeft: days };
  } catch (e) {
    const detail = e.response?.data?.error?.message || e.message;
    console.log(`[IGToken] ⚠️ Token is NOT usable: ${detail}`);
    return { ok: false, reason: detail };
  }
}

module.exports = { getToken, refreshIfNeeded, checkHealth, TOKEN_FILE };
