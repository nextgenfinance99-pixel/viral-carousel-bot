const path = require('path');
const sharp = require('sharp');
const tg = require('./telegram');
const { getDraft, getAsset, updateAsset, publishAsset, regenerateAsset } = require('./dailyChallenge');

const AVATARS_DIR = path.join(__dirname, '../assets/avatars');
const VALID_SLOTS = ['host', 'boy', 'girl'];

// Save a photo the user sent as a host/avatar image (slot from the caption).
async function setAvatarFromPhoto(fileId, captionRaw, chatId) {
  const slot = VALID_SLOTS.includes(String(captionRaw || '').trim().toLowerCase())
    ? String(captionRaw).trim().toLowerCase() : 'host';
  const tmp = path.join(AVATARS_DIR, `_incoming_${Date.now()}`);
  try {
    await tg.downloadFile(fileId, tmp);
    await sharp(tmp).resize(1280, 1280, { fit: 'inside', withoutEnlargement: true }).png()
      .toFile(path.join(AVATARS_DIR, `${slot}.png`));
    await tg.sendMessage(`✅ Updated the <b>${slot}</b> image. New reels will use it.${slot === 'host' ? '' : `\n(Tip: add a caption "host", "boy" or "girl" with the photo to target a slot.)`}`, undefined, chatId);
  } catch (e) {
    await tg.sendMessage(`❌ Could not save that image: ${e.message}`, undefined, chatId);
  } finally {
    try { require('fs').rmSync(tmp, { force: true }); } catch {}
  }
}

// Chats awaiting a free-text "what changes?" reply → { dateKey, assetId, title }
const pendingFeedback = new Map();

function isOn() { return tg.isConfigured(); }

function buttons(dateKey, assetId) {
  return {
    inline_keyboard: [
      [
        { text: '✅ Approve & Post', callback_data: `ap:${dateKey}:${assetId}` },
        { text: '✏️ Changes',        callback_data: `ch:${dateKey}:${assetId}` },
      ],
      [{ text: '⏭ Skip', callback_data: `sk:${dateKey}:${assetId}` }],
    ],
  };
}

function assetCaption(asset, prefix = '') {
  const head = `${prefix}🎬 <b>${asset.title || asset.kind}</b>\n${(asset.kind || '').toUpperCase()}${asset.badge ? ' · ' + asset.badge : ''} · ${asset.voice || ''}`;
  const body = asset.caption ? `\n\n${asset.caption}` : '';
  return (head + body).slice(0, 1024);
}

// Send one asset's video + review buttons.
async function pushAsset(dateKey, asset, prefix = '') {
  if (!asset || asset.status !== 'ready' || !asset.videoPath) return;
  try {
    await tg.sendVideo(asset.videoPath, assetCaption(asset, prefix), buttons(dateKey, asset.id));
  } catch (e) {
    // Fall back to a text card if the video upload fails.
    await tg.sendMessage(`${assetCaption(asset, prefix)}\n\n⚠️ (video upload failed: ${e.message})`, buttons(dateKey, asset.id));
  }
}

// Send the whole day's draft for review.
async function pushDraft(draft) {
  if (!isOn() || !draft) return;
  const ready = (draft.assets || []).filter((a) => a.status === 'ready' && a.videoPath);
  if (!ready.length) { await tg.sendMessage(`⚠️ Day ${draft.day} draft generated but no reels are ready to review.`); return; }
  await tg.sendMessage(`📦 <b>Day ${draft.day}/${draft.challengeLength}</b> draft is ready — ${ready.length} reels to review.\nTap ✅ to post, ✏️ to request changes, or ⏭ to skip.`);
  for (const asset of ready) await pushAsset(draft.dateKey, asset);
}

// ── Callback (button tap) handler ─────────────────────────────────────────────
async function onCallback(cb) {
  const data = cb.data || '';
  const chatId = cb.message?.chat?.id;
  const messageId = cb.message?.message_id;
  const [action, dateKey, assetId] = data.split(':');
  const asset = getAsset(dateKey, assetId);
  if (!asset) { await tg.answerCallback(cb.id, 'That draft is no longer available.'); return; }

  if (action === 'ap') {
    await tg.answerCallback(cb.id, 'Posting to Instagram…');
    await tg.editCaption(chatId, messageId, assetCaption(asset, '⏳ Posting… '));
    try {
      const r = await publishAsset(dateKey, assetId, ['instagram']);
      const ok = r.ok;
      const detail = ok
        ? `✅ Posted to Instagram (id ${r.results.instagram?.id})`
        : `❌ Post failed: ${Object.values(r.results).map((v) => v.error).filter(Boolean).join('; ')}`;
      await tg.editCaption(chatId, messageId, `${detail}\n\n${assetCaption(asset)}`);
    } catch (e) {
      await tg.editCaption(chatId, messageId, `❌ Post failed: ${e.message}\n\n${assetCaption(asset)}`, buttons(dateKey, assetId));
    }
  } else if (action === 'ch') {
    pendingFeedback.set(String(chatId), { dateKey, assetId, title: asset.title });
    await tg.answerCallback(cb.id, 'Tell me what to change');
    await tg.sendMessage(`✏️ Reply with the changes you want for <b>${asset.title}</b> and I'll regenerate it.`);
  } else if (action === 'sk') {
    updateAsset(dateKey, assetId, { approved: false, skipped: true });
    await tg.answerCallback(cb.id, 'Skipped');
    await tg.editCaption(chatId, messageId, `⏭ Skipped.\n\n${assetCaption(asset)}`);
  } else {
    await tg.answerCallback(cb.id, '');
  }
}

// ── Message handler (free-text feedback after tapping ✏️ Changes) ─────────────
async function onMessage(msg) {
  const chatId = String(msg.chat?.id || '');

  // A photo (or image file) → update a host/avatar slot.
  if (msg.photo && msg.photo.length) {
    await setAvatarFromPhoto(msg.photo[msg.photo.length - 1].file_id, msg.caption, chatId);
    return;
  }
  if (msg.document && /^image\//.test(msg.document.mime_type || '')) {
    await setAvatarFromPhoto(msg.document.file_id, msg.caption, chatId);
    return;
  }

  const text = (msg.text || '').trim();
  if (!text) return;

  if (text === '/start' || text === '/help' || text === '/id') {
    await tg.sendMessage(`👋 Connected! This is your DEVELOPSCHL reel review bot.\nYour chat id is <code>${chatId}</code>.\n\n• Daily drafts arrive here — tap ✅ to post, ✏️ to request changes (reply with notes), ⏭ to skip.\n• <b>Change pictures:</b> just send me a photo to update your host intro image (add caption "boy" or "girl" to set those instead).`, undefined, chatId);
    return;
  }

  const pending = pendingFeedback.get(chatId);
  if (!pending) return; // not awaiting feedback — ignore
  pendingFeedback.delete(chatId);

  await tg.sendMessage(`🔁 Regenerating <b>${pending.title}</b> with your notes…`, undefined, chatId);
  try {
    const updated = await regenerateAsset(pending.dateKey, pending.assetId, text);
    if (updated && updated.status === 'ready') await pushAsset(pending.dateKey, updated, '🔁 Regenerated — ');
    else await tg.sendMessage(`⚠️ Regeneration finished but the reel isn't ready: ${updated?.error || 'unknown error'}`, undefined, chatId);
  } catch (e) {
    await tg.sendMessage(`❌ Regeneration failed: ${e.message}`, undefined, chatId);
  }
}

function start() {
  if (!isOn()) { console.log('[Telegram] Review bot off (set TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID).'); return; }
  tg.startPolling({ onCallback, onMessage });
}

module.exports = { start, pushDraft, pushAsset, isOn };
