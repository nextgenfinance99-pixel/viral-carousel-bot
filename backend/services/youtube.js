/**
 * youtube.js — upload a vertical MP4 as a YouTube Short. No extra npm deps:
 * we exchange a stored refresh token for an access token, then do a resumable
 * upload with axios.
 *
 * Setup (one time):
 *   1. Google Cloud project → enable "YouTube Data API v3".
 *   2. OAuth client (Desktop) → YT_CLIENT_ID + YT_CLIENT_SECRET.
 *   3. Authorise once with scope https://www.googleapis.com/auth/youtube.upload
 *      and store the resulting refresh token → YT_REFRESH_TOKEN.
 *
 * A video is treated as a Short automatically when it's vertical and <= 3 min;
 * we also append #Shorts to the title/description to help classification.
 */
const axios = require('axios');
const fs = require('fs');

function isConfigured() {
  return !!(process.env.YT_CLIENT_ID && process.env.YT_CLIENT_SECRET && process.env.YT_REFRESH_TOKEN);
}

async function getAccessToken() {
  const res = await axios.post('https://oauth2.googleapis.com/token', new URLSearchParams({
    client_id: process.env.YT_CLIENT_ID,
    client_secret: process.env.YT_CLIENT_SECRET,
    refresh_token: process.env.YT_REFRESH_TOKEN,
    grant_type: 'refresh_token',
  }).toString(), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 15000 });
  return res.data.access_token;
}

/**
 * @param {string} videoPath absolute path to the mp4
 * @param {{title?:string, description?:string, tags?:string[], privacyStatus?:string}} meta
 * @returns {Promise<{id:string, url:string}>}
 */
async function uploadShort(videoPath, meta = {}) {
  if (!isConfigured()) throw new Error('YouTube not configured (set YT_CLIENT_ID, YT_CLIENT_SECRET, YT_REFRESH_TOKEN)');
  if (!fs.existsSync(videoPath)) throw new Error(`Video not found: ${videoPath}`);

  const accessToken = await getAccessToken();
  const title = `${(meta.title || 'AI Tool of the Day').slice(0, 95)} #Shorts`;
  const description = `${meta.description || ''}\n\n#Shorts #AI #AITools`.trim().slice(0, 4900);
  const snippet = {
    snippet: { title, description, tags: meta.tags || ['AI', 'AI tools', 'shorts'], categoryId: '28' },
    status: { privacyStatus: meta.privacyStatus || 'public', selfDeclaredMadeForKids: false },
  };

  const stat = fs.statSync(videoPath);

  // 1) Start resumable session
  const init = await axios.post(
    'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status',
    snippet,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Length': stat.size,
        'X-Upload-Content-Type': 'video/*',
      },
      timeout: 20000,
    }
  );
  const uploadUrl = init.headers.location;
  if (!uploadUrl) throw new Error('YouTube did not return a resumable upload URL');

  // 2) Upload the bytes
  const res = await axios.put(uploadUrl, fs.createReadStream(videoPath), {
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'video/*', 'Content-Length': stat.size },
    maxBodyLength: Infinity, maxContentLength: Infinity, timeout: 600000,
  });

  const id = res.data.id;
  console.log(`[YouTube] Uploaded Short: ${id}`);
  return { id, url: `https://youtube.com/shorts/${id}` };
}

module.exports = { uploadShort, isConfigured };
