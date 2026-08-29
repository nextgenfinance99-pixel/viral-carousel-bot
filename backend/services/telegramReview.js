const fs = require('fs');
const path = require('path');
const tg = require('./telegram');
const { getDraft, getAsset, updateAsset, publishAsset, regenerateAsset, postDailyStory } = require('./dailyChallenge');

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

  // Story recap: 'st' renders a preview, 'sy' publishes it. Same review-first rule
  // as every other asset — a Story is public the moment it lands.
  if (action === 'sy') {
    await tg.answerCallback(cb.id, 'Posting story…');
    try {
      const r = await postDailyStory(dateKey, { force: true });
      await tg.sendMessage(r.ok
        ? `📸 Story posted — covering ${r.count} post(s).`
        : `⚠️ Story not posted: ${r.reason}`, undefined, chatId);
    } catch (e) {
      await tg.sendMessage(`⚠️ Story failed: ${e.message}`, undefined, chatId);
    }
    return;
  }

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

  // Photos used to set a host image. That system is gone — reels are drawn
  // entirely from code — so say so rather than silently ignoring the upload.
  if ((msg.photo && msg.photo.length) || (msg.document && /^image\//.test(msg.document.mime_type || ''))) {
    await tg.sendMessage('📷 Reels are generated from the brand template now — host images are no longer used, so this photo was not saved.', undefined, chatId);
    return;
  }

  // A VIDEO sets the presenter clip. This is the only way to get it onto the Render
  // disk: the repo is public, so the avatar is deliberately git-ignored and is not in
  // the image. Distinct from the banned host PHOTO — a still face held for a whole
  // reel is the thing that was removed; this is the moving presenter the split-screen
  // format needs, and the user asked for it explicitly.
  const vid = msg.video || (msg.document && /^video\//.test(msg.document.mime_type || '') ? msg.document : null);
  if (vid) {
    try {
      const destDir = path.join(__dirname, '../assets/presenter');
      fs.mkdirSync(destDir, { recursive: true });
      const dest = path.join(destDir, 'presenter.mp4');
      await tg.downloadFile(vid.file_id, dest);
      const mb = (fs.statSync(dest).size / 1048576).toFixed(1);
      await tg.sendMessage(`🎬 Presenter clip saved (${mb}MB). It will appear beneath the B-roll in the next reel.`, undefined, chatId);
    } catch (e) {
      await tg.sendMessage(`⚠️ Could not save that video: ${e.message}`, undefined, chatId);
    }
    return;
  }

  const text = (msg.text || '').trim();
  if (!text) return;

  if (text === '/story') {
    try {
      const r = await postDailyStory(undefined, { renderOnly: true, force: true });
      if (!r.ok) { await tg.sendMessage(`No story: ${r.reason}`, undefined, chatId); return; }
      const today = new Date();
      const key = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
      await tg.sendPhoto(r.filepath, `📸 Story recap — ${r.count} post(s) today. Post it?`, {
        inline_keyboard: [[{ text: '✅ Post story', callback_data: `sy:${key}:-` }]],
      }, chatId);
    } catch (e) {
      await tg.sendMessage(`⚠️ Story preview failed: ${e.message}`, undefined, chatId);
    }
    return;
  }

  if (text === '/start' || text === '/help' || text === '/id') {
    await tg.sendMessage(`👋 Connected! This is your DEVELOPSCHL reel review bot.\nYour chat id is <code>${chatId}</code>.\n\n• Daily drafts arrive here — tap ✅ to post, ✏️ to request changes (reply with notes), ⏭ to skip.\n• Reels are drawn from the brand template. Send a VIDEO to set the presenter clip that sits under the B-roll (photos are not used).
• /story — preview and post a Story recapping everything posted today.`, undefined, chatId);
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

// Send a plain operational alert (token expiry, failed run) to the review chat.
async function notify(html) {
  if (!isOn()) return;
  await tg.sendMessage(html);
}

module.exports = { start, pushDraft, pushAsset, isOn, notify };
