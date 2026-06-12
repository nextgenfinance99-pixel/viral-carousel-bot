const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');

// ── Telegram Bot API client (long-polling, no public URL needed) ──────────────
// Configure in .env:
//   TELEGRAM_BOT_TOKEN=123456:ABC...   (from @BotFather)
//   TELEGRAM_CHAT_ID=123456789          (your personal chat id with the bot)

const TOKEN = () => process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = () => process.env.TELEGRAM_CHAT_ID;
const API = () => `https://api.telegram.org/bot${TOKEN()}`;

function isConfigured() {
  return !!(TOKEN() && CHAT_ID());
}

async function call(method, params = {}) {
  const res = await axios.post(`${API()}/${method}`, params, { timeout: 30000 });
  if (!res.data.ok) throw new Error(`Telegram ${method}: ${res.data.description}`);
  return res.data.result;
}

async function sendMessage(text, replyMarkup, chatId = CHAT_ID()) {
  return call('sendMessage', {
    chat_id: chatId, text, parse_mode: 'HTML',
    disable_web_page_preview: true,
    ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
  });
}

// Upload a local mp4 as a Telegram video message with optional inline buttons.
async function sendVideo(videoPath, caption, replyMarkup, chatId = CHAT_ID()) {
  const form = new FormData();
  form.append('chat_id', String(chatId));
  if (caption) { form.append('caption', caption.slice(0, 1024)); form.append('parse_mode', 'HTML'); }
  if (replyMarkup) form.append('reply_markup', JSON.stringify(replyMarkup));
  form.append('supports_streaming', 'true');
  form.append('video', fs.createReadStream(videoPath));
  const res = await axios.post(`${API()}/sendVideo`, form, {
    headers: form.getHeaders(), timeout: 120000,
    maxBodyLength: Infinity, maxContentLength: Infinity,
  });
  if (!res.data.ok) throw new Error(`Telegram sendVideo: ${res.data.description}`);
  return res.data.result;
}

// Download a Telegram file (e.g. a photo the user sent) to a local path.
async function downloadFile(fileId, destPath) {
  const f = await call('getFile', { file_id: fileId });
  const url = `https://api.telegram.org/file/bot${TOKEN()}/${f.file_path}`;
  const res = await axios.get(url, { responseType: 'arraybuffer', timeout: 60000 });
  fs.writeFileSync(destPath, Buffer.from(res.data));
  return destPath;
}

async function answerCallback(callbackQueryId, text) {
  try { await call('answerCallbackQuery', { callback_query_id: callbackQueryId, text: text || '' }); } catch {}
}

async function editCaption(chatId, messageId, caption, replyMarkup) {
  try {
    await call('editMessageCaption', {
      chat_id: chatId, message_id: messageId, caption: caption.slice(0, 1024), parse_mode: 'HTML',
      ...(replyMarkup ? { reply_markup: replyMarkup } : { reply_markup: { inline_keyboard: [] } }),
    });
  } catch {}
}

// ── Long-polling loop ─────────────────────────────────────────────────────────
let polling = false;
let offset = 0;

async function startPolling({ onCallback, onMessage }) {
  if (polling) return;
  if (!isConfigured()) { console.log('[Telegram] Not configured — review bot off.'); return; }
  polling = true;

  // Clear any backlog so we don't replay old taps after a restart.
  try {
    const me = await call('getMe');
    console.log(`[Telegram] Review bot online as @${me.username}`);
    const backlog = await call('getUpdates', { timeout: 0, offset: -1 });
    if (backlog.length) offset = backlog[backlog.length - 1].update_id + 1;
  } catch (e) {
    console.log(`[Telegram] getMe failed — check TELEGRAM_BOT_TOKEN: ${e.message}`);
    polling = false; return;
  }

  (async function loop() {
    while (polling) {
      try {
        const updates = await call('getUpdates', { timeout: 50, offset, allowed_updates: ['message', 'callback_query'] });
        for (const u of updates) {
          offset = u.update_id + 1;
          try {
            if (u.callback_query && onCallback) await onCallback(u.callback_query);
            else if (u.message && onMessage) await onMessage(u.message);
          } catch (e) { console.log(`[Telegram] handler error: ${e.message}`); }
        }
      } catch (e) {
        // Network blip / long-poll timeout — back off briefly and continue.
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
  })();
}

function stopPolling() { polling = false; }

module.exports = { isConfigured, sendMessage, sendVideo, downloadFile, answerCallback, editCaption, startPolling, stopPolling, CHAT_ID };
