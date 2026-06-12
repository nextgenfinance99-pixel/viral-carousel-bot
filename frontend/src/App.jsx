import { useState, useEffect, useRef } from 'react';
import {
  fetchNews,
  generateSlides,
  generateReel,
  uploadReelAsset,
  getReelAssets,
  getReelIntro,
  saveReelIntro,
  generateCustomSlides,
  postCarousel,
  runPipeline,
  startScheduler,
  stopScheduler,
  getSchedulerStatus,
  getTrending,
  getQueue,
  addToQueue,
  removeFromQueue,
  getDailyStatus,
  ingestTools,
  generateDaily,
  approveAsset,
  publishAsset,
} from './api';
import './App.css';

const CRON_PRESETS = [
  { label: 'Every hour',       value: '0 * * * *' },
  { label: 'Every 6 hours',    value: '0 */6 * * *' },
  { label: 'Every 12 hours',   value: '0 */12 * * *' },
  { label: 'Once a day (9am)', value: '0 9 * * *' },
  { label: 'Twice a day',      value: '0 9,18 * * *' },
];

const IMG_BASE = (import.meta.env.VITE_API_URL || 'http://localhost:3001/api').replace('/api', '');

export default function App() {
  const [topic, setTopic]           = useState('');
  const [article, setArticle]       = useState(null);
  const [seenUrls, setSeenUrls]     = useState([]);
  const [trending, setTrending]     = useState([]);
  const [loadingTrend, setLoadingTrend] = useState(false);
  const [slides, setSlides]         = useState([]);
  const [caption, setCaption]       = useState('');
  const [imageUrls, setImageUrls]   = useState([]);
  const [imagePaths, setImagePaths] = useState([]);
  const [loading, setLoading]       = useState({ news: false, generate: false, post: false, pipeline: false, reel: false });

  // Reel generator state
  const [reelMode, setReelMode]     = useState('tool'); // 'tool' | 'topic' | 'trending'
  const [reelTool, setReelTool]     = useState({ name: '', tagline: '', description: '', url: '' });
  const [reelTopic, setReelTopic]   = useState('');
  const [reelHost, setReelHost]     = useState('auto'); // auto | girl | boy | none
  const [reelResult, setReelResult] = useState(null);
  const [reelAssets, setReelAssets] = useState({ host: false, boy: false, girl: false });
  const [introCfg, setIntroCfg]     = useState({ enabled: true, text: 'AI TOOL OF THE DAY', narration: '' });
  const [introSaved, setIntroSaved] = useState(false);
  const [uploadingSlot, setUploadingSlot] = useState(null);
  const hostFileRef = useRef(null);
  const [error, setError]           = useState(null);
  const [posted, setPosted]         = useState(null);
  const [activeTab, setActiveTab]   = useState('manual');

  // Create Your Own state
  const [customTitle, setCustomTitle]   = useState('');
  const [customBody, setCustomBody]     = useState('');
  const [customImage, setCustomImage]   = useState(null);
  const [customPreview, setCustomPreview] = useState(null);
  const fileInputRef = useRef(null);

  // Queue state
  const [postQueue, setPostQueue]         = useState([]);
  const [scheduleMode, setScheduleMode]   = useState('now'); // 'now' | 'schedule'
  const [scheduledAt, setScheduledAt]     = useState('');
  const [queueSuccess, setQueueSuccess]   = useState(false);
  const [schedulerStatus, setSchedulerStatus] = useState(null);
  const [cronExpression, setCronExpression]   = useState('0 9 * * *');

  // Daily 100-day challenge state
  const [daily, setDaily]             = useState(null); // { challenge, draft, generating, capabilities }
  const [dailyBusy, setDailyBusy]     = useState(false);
  const [publishing, setPublishing]   = useState(null); // assetId currently posting

  useEffect(() => {
    fetchStatus();
    loadTrending();
    loadQueue();
    const interval = setInterval(() => { fetchStatus(); loadQueue(); }, 10000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (activeTab === 'reel') loadReelMeta();
    if (activeTab === 'daily') loadDaily();
  }, [activeTab]);

  // Poll daily status while a generation is running (or the tab is open).
  useEffect(() => {
    if (activeTab !== 'daily') return;
    const t = setInterval(loadDaily, 8000);
    return () => clearInterval(t);
  }, [activeTab]);

  async function loadDaily() {
    try { setDaily(await getDailyStatus()); } catch {}
  }
  async function handleIngestTools() {
    setDailyBusy(true); setError(null);
    try { const r = await ingestTools(); await loadDaily(); alert(`Tool store refreshed: +${r.added} new (${r.total} total).`); }
    catch (e) { setError(e?.response?.data?.error || e.message); }
    finally { setDailyBusy(false); }
  }
  async function handleGenerateDaily(force) {
    setDailyBusy(true); setError(null);
    try { await generateDaily({ force }); await loadDaily(); }
    catch (e) { setError(e?.response?.data?.error || e.message); }
    finally { setDailyBusy(false); }
  }
  async function handleApprove(assetId, approved) {
    if (!daily?.draft) return;
    try { await approveAsset(daily.draft.dateKey, assetId, approved); await loadDaily(); }
    catch (e) { setError(e?.response?.data?.error || e.message); }
  }
  async function handlePublish(assetId, targets) {
    if (!daily?.draft) return;
    setPublishing(assetId); setError(null);
    try {
      const r = await publishAsset(daily.draft.dateKey, assetId, targets);
      await loadDaily();
      const ok = Object.entries(r.results || {}).filter(([, v]) => v.ok).map(([k]) => k);
      const fail = Object.entries(r.results || {}).filter(([, v]) => !v.ok);
      alert(ok.length ? `Posted to: ${ok.join(', ')}` : `Failed: ${fail.map(([k, v]) => `${k} — ${v.error}`).join('; ')}`);
    } catch (e) { setError(e?.response?.data?.error || e.message); }
    finally { setPublishing(null); }
  }

  async function loadQueue() {
    try { setPostQueue(await getQueue()); } catch {}
  }

  async function loadTrending() {
    setLoadingTrend(true);
    try { setTrending(await getTrending()); } catch {}
    finally { setLoadingTrend(false); }
  }

  async function fetchStatus() {
    try { setSchedulerStatus(await getSchedulerStatus()); } catch {}
  }

  function setLoad(key, val) {
    setLoading((p) => ({ ...p, [key]: val }));
  }

  async function handleFetchNews(refresh = false) {
    if (!topic.trim()) return setError('Enter a topic to scan');
    setError(null);
    setSlides([]);
    setImageUrls([]);
    setPosted(null);
    setLoad('news', true);
    try {
      const exclude = refresh && article ? [...seenUrls] : [];
      const art = await fetchNews(topic, exclude);
      setArticle(art);
      setSeenUrls((prev) => [...new Set([...prev, art.url])]);
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setLoad('news', false);
    }
  }

  async function handleGenerate() {
    if (!article) return;
    setError(null);
    setSlides([]);
    setImageUrls([]);
    setPosted(null);
    setLoad('generate', true);
    try {
      const result = await generateSlides(article, topic);
      setSlides(result.slides);
      setCaption(result.caption);
      setImageUrls(result.imageUrls);
      setImagePaths(result.imagePaths);
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setLoad('generate', false);
    }
  }

  async function handlePost() {
    setError(null);
    setLoad('post', true);
    try {
      const result = await postCarousel(imagePaths, caption, article?.url);
      setPosted(result.postId);
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setLoad('post', false);
    }
  }

  async function handleGenerateReel() {
    setError(null);
    setReelResult(null);
    let payload = { host: reelHost };
    if (reelMode === 'tool') {
      if (!reelTool.name.trim()) return setError('Enter the AI tool name');
      payload.tool = reelTool;
    } else if (reelMode === 'topic') {
      if (!reelTopic.trim()) return setError('Enter a topic to scan');
      payload.topic = reelTopic;
    } else {
      payload.trending = true;
    }
    setLoad('reel', true);
    try {
      const result = await generateReel(payload);
      setReelResult(result);
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setLoad('reel', false);
    }
  }

  async function loadReelMeta() {
    try { setReelAssets(await getReelAssets()); } catch {}
    try {
      const cfg = await getReelIntro();
      setIntroCfg((p) => ({ ...p, ...cfg }));
    } catch {}
  }

  async function handleUploadAsset(slot, file) {
    if (!file) return;
    setError(null);
    setUploadingSlot(slot);
    try {
      await uploadReelAsset(slot, file);
      await loadReelMeta();
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setUploadingSlot(null);
    }
  }

  async function handleSaveIntro() {
    setError(null);
    try {
      await saveReelIntro(introCfg);
      setIntroSaved(true);
      setTimeout(() => setIntroSaved(false), 3000);
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    }
  }

  async function handleRunPipeline() {
    setError(null);
    setLoad('pipeline', true);
    try {
      const result = await runPipeline();
      alert(`Posted! "${result.article}"`);
      fetchStatus();
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setLoad('pipeline', false);
    }
  }

  async function handleStartScheduler() {
    try { await startScheduler(cronExpression); fetchStatus(); }
    catch (e) { setError(e.response?.data?.error || e.message); }
  }

  async function handleStopScheduler() {
    try { await stopScheduler(); fetchStatus(); } catch (e) { setError(e.message); }
  }

  async function handleSchedulePost() {
    if (!scheduledAt) return setError('Pick a date and time to schedule');
    setError(null);
    try {
      await addToQueue({ title: customTitle, imagePaths, caption, scheduledAt: new Date(scheduledAt).toISOString() });
      setQueueSuccess(true);
      loadQueue();
      setTimeout(() => setQueueSuccess(false), 4000);
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    }
  }

  async function handleCancelQueued(id) {
    await removeFromQueue(id);
    loadQueue();
  }

  async function handleCustomGenerate() {
    if (!customTitle.trim() || !customBody.trim()) return setError('Title and content are required');
    setError(null);
    setSlides([]);
    setImageUrls([]);
    setPosted(null);
    setLoad('generate', true);
    try {
      const result = await generateCustomSlides(customTitle, customBody, customImage);
      setSlides(result.slides);
      setCaption(result.caption);
      setImageUrls(result.imageUrls);
      setImagePaths(result.imagePaths);
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setLoad('generate', false);
    }
  }

  function handleImageSelect(file) {
    if (!file) return;
    setCustomImage(file);
    const reader = new FileReader();
    reader.onload = (e) => setCustomPreview(e.target.result);
    reader.readAsDataURL(file);
  }

  const inputStyle = {
    width: '100%', padding: '0.6rem 0.8rem', background: 'var(--bg3)',
    border: '1px solid var(--border)', borderRadius: '6px', color: 'var(--text)',
    fontFamily: 'var(--mono)', fontSize: '0.85rem',
  };

  // Step states
  const step1Done   = !!article;
  const step2Done   = slides.length > 0;
  const step3Done   = !!posted;

  return (
    <div className="app">
      {/* ── HEADER ── */}
      <header className="header">
        <div className="header-inner">
          <div className="header-logo">
            <div className="logo-icon">🤖</div>
            <div>
              <h1>CAROUSEL.AI</h1>
              <p>AUTOMATED INSTAGRAM CONTENT PIPELINE</p>
            </div>
          </div>
          <div className="header-status">
            <div className="status-dot" />
            SYSTEM ONLINE
          </div>
        </div>
      </header>

      <main className="main">
        {/* ── TABS ── */}
        <div className="tabs">
          <button className={activeTab === 'manual' ? 'tab active' : 'tab'} onClick={() => setActiveTab('manual')}>
            MANUAL
          </button>
          <button className={activeTab === 'custom' ? 'tab active' : 'tab'} onClick={() => setActiveTab('custom')}>
            CREATE YOUR OWN
          </button>
          <button className={activeTab === 'reel' ? 'tab active' : 'tab'} onClick={() => setActiveTab('reel')}>
            🎬 REEL
          </button>
          <button className={activeTab === 'daily' ? 'tab active' : 'tab'} onClick={() => setActiveTab('daily')}>
            📅 DAILY
          </button>
          <button className={activeTab === 'auto' ? 'tab active' : 'tab'} onClick={() => setActiveTab('auto')}>
            AUTO SCHEDULER
          </button>
        </div>

        {/* ── ERROR ── */}
        {error && <div className="error-banner">⚠ {error}</div>}

        {/* ── TRENDING PANEL ── */}
        {activeTab === 'manual' && (
          <div className="panel">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.8rem' }}>
              <span style={{ fontFamily: 'var(--mono)', fontSize: '0.7rem', color: 'var(--cyan)', letterSpacing: '2px', textTransform: 'uppercase' }}>
                ⚡ HN TRENDING NOW
              </span>
              <button className="btn btn-cyan" onClick={loadTrending} disabled={loadingTrend}
                style={{ padding: '0.3rem 0.8rem', fontSize: '0.7rem' }}>
                {loadingTrend ? '...' : 'REFRESH'}
              </button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', maxHeight: '220px', overflowY: 'auto' }}>
              {trending.slice(0, 15).map((s, i) => (
                <div key={i}
                  onClick={() => { setTopic(s.title); setSeenUrls([]); }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '0.8rem',
                    padding: '0.5rem 0.7rem', background: 'var(--bg3)',
                    border: '1px solid var(--border)', borderRadius: '6px',
                    cursor: 'pointer', transition: 'border-color 0.2s',
                  }}
                  onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--cyan)'}
                  onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}
                >
                  <span style={{ fontFamily: 'var(--mono)', fontSize: '0.7rem', color: 'var(--yellow)', minWidth: '45px' }}>
                    ▲ {s.points}
                  </span>
                  <span style={{ fontSize: '0.82rem', color: 'var(--text)', flex: 1, lineHeight: 1.3 }}>{s.title}</span>
                  <span style={{ fontFamily: 'var(--mono)', fontSize: '0.65rem', color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>
                    {s.source}
                  </span>
                </div>
              ))}
              {!loadingTrend && trending.length === 0 && (
                <div style={{ fontFamily: 'var(--mono)', fontSize: '0.75rem', color: 'var(--text-mute)', padding: '0.5rem' }}>
                  Click REFRESH to load trending stories
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── MANUAL MODE ── */}
        {activeTab === 'manual' && (
          <div className="workflow">

            {/* STEP 1 — SCAN */}
            <div className={`step ${step1Done ? 'done' : 'active'}`}>
              <div className="step-connector">
                <div className="step-num">{step1Done ? '✓' : '01'}</div>
                <div className="step-line" />
              </div>
              <div className="step-body">
                <div className="step-header">
                  <span className="step-label">SCAN NEWS</span>
                  <span className="step-tag">{step1Done ? 'COMPLETE' : 'PENDING'}</span>
                </div>
                <div className="panel">
                  <div className="topic-input-row">
                    <div className="topic-input-wrap">
                      <span className="input-prefix">&gt;</span>
                      <input
                        type="text"
                        placeholder="openai / anthropic / ai layoffs..."
                        value={topic}
                        onChange={(e) => { setTopic(e.target.value); setSeenUrls([]); }}
                        onKeyDown={(e) => e.key === 'Enter' && handleFetchNews(false)}
                      />
                    </div>
                    <button className="btn btn-cyan" onClick={() => handleFetchNews(false)} disabled={loading.news}>
                      {loading.news ? 'SCANNING...' : 'SCAN'}
                    </button>
                    {article && (
                      <button className="btn btn-yellow" onClick={() => handleFetchNews(true)} disabled={loading.news}>
                        {loading.news ? '...' : 'REFRESH'}
                      </button>
                    )}
                  </div>

                  {article && (
                    <div className="article-card" style={{ marginTop: '1rem' }}>
                      <div className="article-meta">
                        <span className="source-badge">{article.source}</span>
                        {article.pubDate && <span className="pub-date">{new Date(article.pubDate).toLocaleDateString()}</span>}
                        {article.points && <span className="pts-badge">{article.points} PTS</span>}
                      </div>
                      <div className="article-title">{article.title}</div>
                      <div className="article-preview">{article.fullText.slice(0, 180)}...</div>
                      <a href={article.url} target="_blank" rel="noreferrer" className="article-link">
                        &gt; READ FULL ARTICLE
                      </a>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* STEP 2 — GENERATE */}
            <div className={`step ${step2Done ? 'done' : step1Done ? 'active' : ''}`}>
              <div className="step-connector">
                <div className="step-num">{step2Done ? '✓' : '02'}</div>
                <div className="step-line" />
              </div>
              <div className="step-body">
                <div className="step-header">
                  <span className="step-label">GENERATE CAROUSEL</span>
                  <span className="step-tag">{step2Done ? 'COMPLETE' : step1Done ? 'READY' : 'LOCKED'}</span>
                </div>
                <div className="panel">
                  <div className="btn-row" style={{ marginBottom: slides.length ? '1.2rem' : 0 }}>
                    <button className="btn btn-cyan" onClick={handleGenerate} disabled={!article || loading.generate}>
                      {loading.generate ? 'GENERATING...' : 'GENERATE SLIDES'}
                    </button>
                  </div>

                  {slides.length > 0 && (
                    <>
                      <div className="slides-label">SLIDE PREVIEW — {slides.length} FRAMES</div>
                      <div className="slides-grid">
                        {slides.map((slide, i) => (
                          <div key={i} className="slide-card">
                            {imageUrls[i] && (
                              <img src={`${IMG_BASE}${imageUrls[i]}`} alt={`Slide ${i + 1}`} className="slide-img" />
                            )}
                            <div className="slide-info">
                              <span className="slide-type">FRAME {i + 1} — {slide.type === 'hook' ? 'PHOTO' : 'TEXT'}</span>
                              <div className="slide-headline">
                                {slide.type === 'hook' ? slide.headline : slide.title}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* STEP 3 — DEPLOY */}
            <div className={`step ${step3Done ? 'done' : step2Done ? 'active' : ''}`}>
              <div className="step-connector">
                <div className="step-num">{step3Done ? '✓' : '03'}</div>
                <div className="step-line" style={{ minHeight: 0, flex: 0 }} />
              </div>
              <div className="step-body">
                <div className="step-header">
                  <span className="step-label">DEPLOY TO INSTAGRAM</span>
                  <span className="step-tag">{step3Done ? 'POSTED' : step2Done ? 'READY' : 'LOCKED'}</span>
                </div>
                <div className="panel">
                  {slides.length > 0 && (
                    <>
                      <div className="caption-section">
                        <span className="caption-label">CAPTION PAYLOAD</span>
                        <textarea
                          value={caption}
                          onChange={(e) => setCaption(e.target.value)}
                          rows={5}
                        />
                      </div>

                      {posted ? (
                        <div className="posted-success">
                          ✓ CAROUSEL DEPLOYED — POST ID: {posted}
                        </div>
                      ) : (
                        <button className="btn btn-instagram btn-full" onClick={handlePost} disabled={loading.post}>
                          {loading.post ? 'DEPLOYING...' : '▶ DEPLOY CAROUSEL TO INSTAGRAM'}
                        </button>
                      )}
                    </>
                  )}

                  {!slides.length && (
                    <div style={{ fontFamily: 'var(--mono)', fontSize: '0.78rem', color: 'var(--text-mute)' }}>
                      Complete steps 01 and 02 to unlock deployment.
                    </div>
                  )}
                </div>
              </div>
            </div>

          </div>
        )}

        {/* ── CREATE YOUR OWN ── */}
        {activeTab === 'custom' && (
          <div className="workflow">

            {/* INPUT */}
            <div className={`step ${slides.length > 0 ? 'done' : 'active'}`}>
              <div className="step-connector">
                <div className="step-num">{slides.length > 0 ? '✓' : '01'}</div>
                <div className="step-line" />
              </div>
              <div className="step-body">
                <div className="step-header">
                  <span className="step-label">YOUR CONTENT</span>
                  <span className="step-tag">{slides.length > 0 ? 'COMPLETE' : 'PENDING'}</span>
                </div>
                <div className="panel" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>

                  {/* Title */}
                  <div className="field">
                    <label>ARTICLE TITLE</label>
                    <input
                      type="text"
                      placeholder="Enter the headline..."
                      value={customTitle}
                      onChange={(e) => setCustomTitle(e.target.value)}
                      style={{ width: '100%', padding: '0.6rem 0.8rem', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: '6px', color: 'var(--text)', fontFamily: 'var(--mono)', fontSize: '0.85rem' }}
                    />
                  </div>

                  {/* Body */}
                  <div className="field">
                    <label>ARTICLE CONTENT</label>
                    <textarea
                      placeholder="Paste the article body here..."
                      value={customBody}
                      onChange={(e) => setCustomBody(e.target.value)}
                      rows={6}
                      style={{ width: '100%', padding: '0.6rem 0.8rem', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: '6px', color: 'var(--text)', fontFamily: 'var(--mono)', fontSize: '0.82rem', resize: 'vertical' }}
                    />
                  </div>

                  {/* Image upload */}
                  <div className="field">
                    <label>SLIDE IMAGE <span style={{ color: 'var(--text-mute)', fontWeight: 400 }}>(optional — AI generates one if not provided)</span></label>
                    <div
                      onClick={() => fileInputRef.current?.click()}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => { e.preventDefault(); handleImageSelect(e.dataTransfer.files[0]); }}
                      style={{
                        border: '2px dashed var(--border)', borderRadius: '8px',
                        padding: '1.5rem', textAlign: 'center', cursor: 'pointer',
                        background: 'var(--bg3)', transition: 'border-color 0.2s',
                      }}
                      onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--cyan)'}
                      onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}
                    >
                      {customPreview ? (
                        <img src={customPreview} alt="preview" style={{ maxHeight: '160px', borderRadius: '6px', objectFit: 'cover' }} />
                      ) : (
                        <span style={{ fontFamily: 'var(--mono)', fontSize: '0.78rem', color: 'var(--text-dim)' }}>
                          ↑ DRAG & DROP or click to upload image
                        </span>
                      )}
                    </div>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      style={{ display: 'none' }}
                      onChange={(e) => handleImageSelect(e.target.files[0])}
                    />
                    {customImage && (
                      <button
                        onClick={() => { setCustomImage(null); setCustomPreview(null); }}
                        style={{ marginTop: '0.4rem', background: 'none', border: 'none', color: 'var(--text-mute)', fontFamily: 'var(--mono)', fontSize: '0.72rem', cursor: 'pointer' }}
                      >
                        ✕ Remove image
                      </button>
                    )}
                  </div>

                  <button className="btn btn-cyan" onClick={handleCustomGenerate} disabled={loading.generate}>
                    {loading.generate ? 'GENERATING...' : '⚡ GENERATE CAROUSEL'}
                  </button>
                </div>
              </div>
            </div>

            {/* PREVIEW */}
            {slides.length > 0 && (
              <div className="step done">
                <div className="step-connector">
                  <div className="step-num">✓</div>
                  <div className="step-line" />
                </div>
                <div className="step-body">
                  <div className="step-header">
                    <span className="step-label">CAROUSEL PREVIEW</span>
                    <span className="step-tag">READY</span>
                  </div>
                  <div className="panel">
                    <div className="slides-label">SLIDE PREVIEW — {slides.length} FRAMES</div>
                    <div className="slides-grid">
                      {slides.map((slide, i) => (
                        <div key={i} className="slide-card">
                          {imageUrls[i] && (
                            <img src={`${IMG_BASE}${imageUrls[i]}`} alt={`Slide ${i + 1}`} className="slide-img" />
                          )}
                          <div className="slide-info">
                            <span className="slide-type">FRAME {i + 1} — {slide.type === 'hook' ? 'PHOTO' : 'TEXT'}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* DEPLOY / SCHEDULE */}
            {slides.length > 0 && (
              <div className={`step ${posted || queueSuccess ? 'done' : 'active'}`}>
                <div className="step-connector">
                  <div className="step-num">{posted || queueSuccess ? '✓' : '02'}</div>
                  <div className="step-line" style={{ minHeight: 0, flex: 0 }} />
                </div>
                <div className="step-body">
                  <div className="step-header">
                    <span className="step-label">DEPLOY TO INSTAGRAM</span>
                    <span className="step-tag">{posted ? 'POSTED' : queueSuccess ? 'SCHEDULED' : 'READY'}</span>
                  </div>
                  <div className="panel">
                    <div className="caption-section">
                      <span className="caption-label">CAPTION PAYLOAD</span>
                      <textarea value={caption} onChange={(e) => setCaption(e.target.value)} rows={4} />
                    </div>

                    {/* Post Now / Schedule toggle */}
                    <div style={{ display: 'flex', gap: '0.6rem', margin: '1rem 0 0.8rem' }}>
                      {['now', 'schedule'].map(mode => (
                        <button key={mode}
                          onClick={() => setScheduleMode(mode)}
                          style={{
                            flex: 1, padding: '0.55rem', fontFamily: 'var(--mono)', fontSize: '0.75rem',
                            fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase',
                            border: `1px solid ${scheduleMode === mode ? 'var(--cyan)' : 'var(--border)'}`,
                            background: scheduleMode === mode ? 'rgba(0,229,255,0.1)' : 'var(--bg3)',
                            color: scheduleMode === mode ? 'var(--cyan)' : 'var(--text-dim)',
                            borderRadius: '6px', cursor: 'pointer', transition: 'all 0.15s',
                          }}>
                          {mode === 'now' ? '▶ Post Now' : '🕐 Schedule'}
                        </button>
                      ))}
                    </div>

                    {scheduleMode === 'now' && (
                      posted ? (
                        <div className="posted-success">✓ CAROUSEL DEPLOYED — POST ID: {posted}</div>
                      ) : (
                        <button className="btn btn-instagram btn-full" onClick={handlePost} disabled={loading.post}>
                          {loading.post ? 'DEPLOYING...' : '▶ DEPLOY CAROUSEL TO INSTAGRAM'}
                        </button>
                      )
                    )}

                    {scheduleMode === 'schedule' && (
                      queueSuccess ? (
                        <div className="posted-success">✓ ADDED TO QUEUE — will post at scheduled time</div>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                          <input
                            type="datetime-local"
                            value={scheduledAt}
                            onChange={(e) => setScheduledAt(e.target.value)}
                            style={{
                              width: '100%', padding: '0.65rem 0.8rem',
                              background: '#ffffff', border: '1px solid var(--border)',
                              borderRadius: '6px', color: '#111111',
                              fontFamily: 'var(--mono)', fontSize: '0.88rem',
                              colorScheme: 'light',
                            }}
                          />
                          <button className="btn btn-cyan btn-full" onClick={handleSchedulePost}>
                            + ADD TO QUEUE
                          </button>
                        </div>
                      )
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* QUEUE PANEL */}
            {postQueue.length > 0 && (
              <div className="panel" style={{ marginTop: '1.5rem' }}>
                <div style={{ fontFamily: 'var(--mono)', fontSize: '0.7rem', color: 'var(--cyan)', letterSpacing: '2px', marginBottom: '0.8rem' }}>
                  📅 SCHEDULED QUEUE — {postQueue.filter(q => q.status === 'pending').length} PENDING
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {postQueue.map(item => (
                    <div key={item.id} style={{
                      display: 'flex', alignItems: 'center', gap: '0.8rem',
                      padding: '0.6rem 0.8rem', background: 'var(--bg3)',
                      border: `1px solid ${item.status === 'posted' ? 'var(--green)' : item.status === 'failed' ? '#ff4444' : 'var(--border)'}`,
                      borderRadius: '6px',
                    }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontFamily: 'var(--mono)', fontSize: '0.78rem', color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {item.title || 'Custom Post'}
                        </div>
                        <div style={{ fontFamily: 'var(--mono)', fontSize: '0.68rem', color: 'var(--text-dim)', marginTop: '0.2rem' }}>
                          🕐 {new Date(item.scheduledAt).toLocaleString()}
                        </div>
                      </div>
                      <span style={{
                        fontFamily: 'var(--mono)', fontSize: '0.65rem', fontWeight: 700, letterSpacing: '1px',
                        padding: '0.2rem 0.5rem', borderRadius: '4px',
                        background: item.status === 'posted' ? 'rgba(0,255,0,0.1)' : item.status === 'failed' ? 'rgba(255,0,0,0.1)' : 'rgba(0,229,255,0.1)',
                        color: item.status === 'posted' ? 'var(--green)' : item.status === 'failed' ? '#ff4444' : 'var(--cyan)',
                      }}>
                        {item.status.toUpperCase()}
                      </span>
                      {item.status === 'pending' && (
                        <button onClick={() => handleCancelQueued(item.id)} style={{
                          background: 'none', border: '1px solid var(--border)', borderRadius: '4px',
                          color: 'var(--text-mute)', fontFamily: 'var(--mono)', fontSize: '0.7rem',
                          padding: '0.2rem 0.5rem', cursor: 'pointer',
                        }}>
                          CANCEL
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

          </div>
        )}

        {/* ── REEL GENERATOR ── */}
        {activeTab === 'reel' && (
          <div className="workflow">

            {/* INTRO & HOST SETUP */}
            <div className="panel" style={{ marginBottom: '1.2rem' }}>
              <div className="slides-label">🎭 INTRO &amp; HOST SETUP</div>

              {/* Upload slots */}
              <div style={{ display: 'flex', gap: '0.6rem', marginTop: '0.7rem' }}>
                {[
                  { slot: 'host', label: 'Intro Host', hint: 'opens every reel' },
                  { slot: 'girl', label: 'Girl (corner)', hint: 'female voice' },
                  { slot: 'boy', label: 'Boy (corner)', hint: 'male voice' },
                ].map(({ slot, label, hint }) => (
                  <label key={slot} style={{
                    flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.2rem',
                    padding: '0.8rem 0.4rem', textAlign: 'center', cursor: uploadingSlot ? 'wait' : 'pointer',
                    border: `2px dashed ${reelAssets[slot] ? 'var(--green)' : 'var(--border)'}`,
                    background: 'var(--bg3)', borderRadius: '8px', transition: 'border-color 0.2s',
                  }}>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: '0.78rem', fontWeight: 700, color: reelAssets[slot] ? 'var(--green)' : 'var(--cyan)' }}>
                      {uploadingSlot === slot ? '⏳ ...' : reelAssets[slot] ? '✓ ' + label : '↑ ' + label}
                    </span>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: '0.62rem', color: 'var(--text-mute)' }}>{hint}</span>
                    <input type="file" accept="image/*" style={{ display: 'none' }}
                      onChange={(e) => handleUploadAsset(slot, e.target.files[0])} />
                  </label>
                ))}
              </div>

              {/* Intro config */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', margin: '1rem 0 0.6rem' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontFamily: 'var(--mono)', fontSize: '0.75rem', color: 'var(--text-dim)', cursor: 'pointer' }}>
                  <input type="checkbox" checked={introCfg.enabled}
                    onChange={(e) => setIntroCfg({ ...introCfg, enabled: e.target.checked })} />
                  INTRO STING ENABLED
                </label>
              </div>
              <div className="field">
                <label>INTRO TITLE <span style={{ color: 'var(--text-mute)', fontWeight: 400 }}>(on-screen)</span></label>
                <input type="text" value={introCfg.text}
                  onChange={(e) => setIntroCfg({ ...introCfg, text: e.target.value })} style={inputStyle} />
              </div>
              <div className="field">
                <label>INTRO SCRIPT <span style={{ color: 'var(--text-mute)', fontWeight: 400 }}>(spoken every reel)</span></label>
                <textarea rows={2} value={introCfg.narration}
                  placeholder="What's up, here is your AI tool of the day."
                  onChange={(e) => setIntroCfg({ ...introCfg, narration: e.target.value })}
                  style={{ ...inputStyle, resize: 'vertical' }} />
              </div>
              <button className="btn btn-cyan" onClick={handleSaveIntro} style={{ marginTop: '0.5rem' }}>
                {introSaved ? '✓ SAVED' : '💾 SAVE INTRO'}
              </button>
              {!reelAssets.host && (
                <div style={{ fontFamily: 'var(--mono)', fontSize: '0.68rem', color: 'var(--text-mute)', marginTop: '0.5rem' }}>
                  Upload an "Intro Host" image to enable the opening sting. Without it, reels start faceless.
                </div>
              )}
            </div>

            {/* INPUT */}
            <div className={`step ${reelResult ? 'done' : 'active'}`}>
              <div className="step-connector">
                <div className="step-num">{reelResult ? '✓' : '01'}</div>
                <div className="step-line" />
              </div>
              <div className="step-body">
                <div className="step-header">
                  <span className="step-label">REEL SOURCE</span>
                  <span className="step-tag">{reelResult ? 'COMPLETE' : 'PENDING'}</span>
                </div>
                <div className="panel" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>

                  {/* Source mode toggle */}
                  <div style={{ display: 'flex', gap: '0.6rem' }}>
                    {[
                      { k: 'tool', label: '🛠 AI Tool' },
                      { k: 'topic', label: '🔎 Topic' },
                      { k: 'trending', label: '⚡ Trending' },
                    ].map(({ k, label }) => (
                      <button key={k} onClick={() => setReelMode(k)}
                        style={{
                          flex: 1, padding: '0.55rem', fontFamily: 'var(--mono)', fontSize: '0.75rem',
                          fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase',
                          border: `1px solid ${reelMode === k ? 'var(--cyan)' : 'var(--border)'}`,
                          background: reelMode === k ? 'rgba(0,229,255,0.1)' : 'var(--bg3)',
                          color: reelMode === k ? 'var(--cyan)' : 'var(--text-dim)',
                          borderRadius: '6px', cursor: 'pointer', transition: 'all 0.15s',
                        }}>
                        {label}
                      </button>
                    ))}
                  </div>

                  {reelMode === 'tool' && (
                    <>
                      <div className="field">
                        <label>TOOL NAME</label>
                        <input type="text" placeholder="e.g. Ollama, Whisper, ComfyUI..."
                          value={reelTool.name}
                          onChange={(e) => setReelTool({ ...reelTool, name: e.target.value })}
                          style={inputStyle} />
                      </div>
                      <div className="field">
                        <label>TAGLINE <span style={{ color: 'var(--text-mute)', fontWeight: 400 }}>(one line)</span></label>
                        <input type="text" placeholder="Open-source X that does Y for free"
                          value={reelTool.tagline}
                          onChange={(e) => setReelTool({ ...reelTool, tagline: e.target.value })}
                          style={inputStyle} />
                      </div>
                      <div className="field">
                        <label>WHAT IT DOES</label>
                        <textarea placeholder="A few sentences on what the tool does and why it's useful..."
                          value={reelTool.description} rows={4}
                          onChange={(e) => setReelTool({ ...reelTool, description: e.target.value })}
                          style={{ ...inputStyle, resize: 'vertical' }} />
                      </div>
                      <div className="field">
                        <label>LINK <span style={{ color: 'var(--text-mute)', fontWeight: 400 }}>(optional)</span></label>
                        <input type="text" placeholder="https://..."
                          value={reelTool.url}
                          onChange={(e) => setReelTool({ ...reelTool, url: e.target.value })}
                          style={inputStyle} />
                      </div>
                    </>
                  )}

                  {reelMode === 'topic' && (
                    <div className="field">
                      <label>TOPIC TO SCAN</label>
                      <input type="text" placeholder="video generation / ai agents / open source llm..."
                        value={reelTopic}
                        onChange={(e) => setReelTopic(e.target.value)}
                        style={inputStyle} />
                    </div>
                  )}

                  {reelMode === 'trending' && (
                    <div style={{ fontFamily: 'var(--mono)', fontSize: '0.78rem', color: 'var(--text-dim)' }}>
                      &gt; Auto-picks the top trending AI/tech story and turns it into a reel.
                    </div>
                  )}

                  {/* Host avatar selector */}
                  <div className="field">
                    <label>HOST AVATAR</label>
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      {[
                        { k: 'auto', label: 'Auto' },
                        { k: 'girl', label: '👩 Girl' },
                        { k: 'boy', label: '👨 Boy' },
                        { k: 'none', label: 'Faceless' },
                      ].map(({ k, label }) => (
                        <button key={k} onClick={() => setReelHost(k)}
                          style={{
                            flex: 1, padding: '0.45rem', fontFamily: 'var(--mono)', fontSize: '0.72rem',
                            fontWeight: 700, border: `1px solid ${reelHost === k ? 'var(--cyan)' : 'var(--border)'}`,
                            background: reelHost === k ? 'rgba(0,229,255,0.1)' : 'var(--bg3)',
                            color: reelHost === k ? 'var(--cyan)' : 'var(--text-dim)',
                            borderRadius: '6px', cursor: 'pointer', transition: 'all 0.15s',
                          }}>
                          {label}
                        </button>
                      ))}
                    </div>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: '0.68rem', color: 'var(--text-mute)', marginTop: '0.3rem', display: 'block' }}>
                      Auto matches the voice gender. Add images at backend/assets/avatars/.
                    </span>
                  </div>

                  <button className="btn btn-cyan" onClick={handleGenerateReel} disabled={loading.reel}>
                    {loading.reel ? '🎬 GENERATING REEL — ~30s...' : '🎬 GENERATE REEL'}
                  </button>
                </div>
              </div>
            </div>

            {/* PREVIEW */}
            {reelResult && (
              <div className="step done">
                <div className="step-connector">
                  <div className="step-num">✓</div>
                  <div className="step-line" style={{ minHeight: 0, flex: 0 }} />
                </div>
                <div className="step-body">
                  <div className="step-header">
                    <span className="step-label">REEL PREVIEW — {reelResult.durationSec}s</span>
                    <span className="step-tag">READY</span>
                  </div>
                  <div className="panel" style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>

                    {/* Video player */}
                    <div style={{ flex: '0 0 auto' }}>
                      <video
                        src={`${IMG_BASE}${reelResult.videoUrl}`}
                        controls autoPlay loop muted playsInline
                        style={{ width: '280px', aspectRatio: '9 / 16', borderRadius: '10px', background: '#000', border: '1px solid var(--border)' }}
                      />
                      <a href={`${IMG_BASE}${reelResult.videoUrl}`} download
                        className="btn btn-cyan btn-full" style={{ marginTop: '0.6rem', textAlign: 'center', textDecoration: 'none', display: 'block' }}>
                        ⬇ DOWNLOAD MP4
                      </a>
                    </div>

                    {/* Script + caption */}
                    <div style={{ flex: 1, minWidth: '240px', display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
                      <div>
                        <div className="slides-label">SCRIPT — {reelResult.script.beats.length} BEATS · {reelResult.script.voice} · 🎵 {reelResult.script.music}</div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', marginTop: '0.5rem' }}>
                          {reelResult.script.beats.map((b, i) => (
                            <div key={i} style={{ padding: '0.5rem 0.7rem', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: '6px' }}>
                              <div style={{ fontFamily: 'var(--mono)', fontSize: '0.7rem', color: 'var(--cyan)', fontWeight: 700, letterSpacing: '1px' }}>
                                {String(i + 1).padStart(2, '0')} · {b.onscreen}
                              </div>
                              <div style={{ fontSize: '0.8rem', color: 'var(--text-dim)', marginTop: '0.2rem', lineHeight: 1.35 }}>
                                {b.narration}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="caption-section">
                        <span className="caption-label">CAPTION</span>
                        <textarea readOnly value={reelResult.script.caption} rows={5}
                          onFocus={(e) => e.target.select()} />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

          </div>
        )}

        {/* ── DAILY 100-DAY CHALLENGE ── */}
        {activeTab === 'daily' && (
          <div className="panel">
            {/* Header: day counter + capabilities */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.6rem', marginBottom: '0.9rem' }}>
              <div>
                <div style={{ fontFamily: 'var(--mono)', fontSize: '1.5rem', fontWeight: 900, color: 'var(--cyan)' }}>
                  DAY {daily?.challenge?.day ?? 0} <span style={{ opacity: 0.5, fontSize: '1rem' }}>/ {daily?.challenge?.length ?? 100}</span>
                </div>
                <div style={{ fontFamily: 'var(--mono)', fontSize: '0.7rem', letterSpacing: '2px', opacity: 0.7 }}>
                  AI TOOLS CHALLENGE · 5 tools / day
                </div>
              </div>
              <div style={{ display: 'flex', gap: '0.4rem', fontSize: '0.65rem', fontFamily: 'var(--mono)' }}>
                <span style={{ padding: '0.2rem 0.5rem', borderRadius: 4, background: daily?.capabilities?.instagram ? 'rgba(0,229,255,0.15)' : 'rgba(255,255,255,0.06)' }}>
                  IG {daily?.capabilities?.instagram ? '✓' : '—'}
                </span>
                <span style={{ padding: '0.2rem 0.5rem', borderRadius: 4, background: daily?.capabilities?.youtube ? 'rgba(0,229,255,0.15)' : 'rgba(255,255,255,0.06)' }}>
                  YT {daily?.capabilities?.youtube ? '✓' : '—'}
                </span>
              </div>
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.9rem' }}>
              <button className="btn btn-cyan" onClick={handleIngestTools} disabled={dailyBusy}>
                {dailyBusy ? '...' : '↻ REFRESH TOOLS'}
              </button>
              <button className="btn btn-green" onClick={() => handleGenerateDaily(false)} disabled={dailyBusy || daily?.generating?.active}>
                {daily?.generating?.active ? '⏳ GENERATING…' : '⚡ GENERATE TODAY'}
              </button>
              {daily?.draft && (
                <button className="btn btn-cyan" onClick={() => handleGenerateDaily(true)} disabled={dailyBusy || daily?.generating?.active}
                  style={{ opacity: 0.8 }}>
                  ↺ REBUILD
                </button>
              )}
            </div>

            {daily?.generating?.active && (
              <div className="status-box status-active" style={{ marginBottom: '0.9rem' }}>
                <div className="status-row"><span className="s-key">STATUS</span><span className="s-val">🟢 Building today's bundle… (renders take a few minutes — assets appear as they finish)</span></div>
              </div>
            )}
            {daily?.generating?.lastError && (
              <div className="error-banner">⚠ Last run: {daily.generating.lastError}</div>
            )}

            {/* Today's picked tools */}
            {daily?.draft?.tools?.length > 0 && (
              <div style={{ marginBottom: '1rem' }}>
                <span className="step-label">TODAY'S 5 TOOLS</span>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginTop: '0.5rem' }}>
                  {daily.draft.tools.map((t, i) => (
                    <a key={i} href={t.url} target="_blank" rel="noreferrer"
                      style={{ padding: '0.3rem 0.6rem', borderRadius: 6, background: 'rgba(0,229,255,0.1)', border: '1px solid rgba(0,229,255,0.25)', fontSize: '0.75rem', textDecoration: 'none', color: 'inherit' }}>
                      <b>{i + 1}. {t.name}</b> <span style={{ opacity: 0.6 }}>· {t.category}{t.isNew ? ' · NEW' : ''}</span>
                    </a>
                  ))}
                </div>
              </div>
            )}

            {/* Asset cards */}
            {daily?.draft?.assets?.length > 0 ? (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '0.9rem' }}>
                {daily.draft.assets.map((a) => (
                  <div key={a.id} style={{ border: '1px solid var(--border, rgba(255,255,255,0.12))', borderRadius: 10, padding: '0.7rem', background: 'rgba(255,255,255,0.02)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
                      <span style={{ fontSize: '0.62rem', fontFamily: 'var(--mono)', letterSpacing: '1px', color: 'var(--cyan)' }}>
                        {a.kind === 'rundown' ? '👧 RUNDOWN' : a.kind === 'howto' ? '👦 HOW-TO' : '📰 UPDATE'}
                      </span>
                      <span style={{ fontSize: '0.6rem', opacity: 0.6 }}>{a.durationSec ? `${a.durationSec}s` : ''}</span>
                    </div>
                    <div style={{ fontSize: '0.8rem', fontWeight: 700, marginBottom: '0.5rem', minHeight: '2.2em' }}>{a.title}</div>

                    {a.status === 'ready' && a.videoUrl ? (
                      <video src={`${IMG_BASE}${a.videoUrl}`} controls style={{ width: '100%', borderRadius: 8, aspectRatio: '9/16', background: '#000', objectFit: 'cover' }} />
                    ) : a.status === 'error' ? (
                      <div style={{ fontSize: '0.7rem', color: 'var(--red, #ff6b6b)', padding: '0.5rem 0' }}>⚠ {a.error}</div>
                    ) : (
                      <div style={{ fontSize: '0.7rem', opacity: 0.6, padding: '0.5rem 0' }}>⏳ {a.status}…</div>
                    )}

                    {a.status === 'ready' && (
                      <>
                        <details style={{ marginTop: '0.5rem' }}>
                          <summary style={{ fontSize: '0.65rem', cursor: 'pointer', opacity: 0.8 }}>CAPTION</summary>
                          <textarea readOnly value={a.caption || ''} rows={4} onFocus={(e) => e.target.select()}
                            style={{ width: '100%', marginTop: '0.3rem', fontSize: '0.7rem' }} />
                        </details>
                        <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap', marginTop: '0.5rem', alignItems: 'center' }}>
                          <a className="btn btn-cyan" href={`${IMG_BASE}${a.videoUrl}`} download
                            style={{ padding: '0.25rem 0.55rem', fontSize: '0.65rem' }}>⬇ MP4</a>
                          <button className="btn" onClick={() => handleApprove(a.id, !a.approved)}
                            style={{ padding: '0.25rem 0.55rem', fontSize: '0.65rem', background: a.approved ? 'var(--green, #2ecc71)' : 'rgba(255,255,255,0.08)', color: a.approved ? '#000' : 'inherit' }}>
                            {a.approved ? '✓ APPROVED' : 'APPROVE'}
                          </button>
                        </div>
                        {a.approved && (
                          <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap', marginTop: '0.4rem' }}>
                            <button className="btn btn-green" disabled={publishing === a.id || !daily?.capabilities?.instagram}
                              onClick={() => handlePublish(a.id, ['instagram'])}
                              style={{ padding: '0.25rem 0.55rem', fontSize: '0.65rem' }}>
                              {publishing === a.id ? '…' : '▶ IG'}
                            </button>
                            <button className="btn btn-green" disabled={publishing === a.id || !daily?.capabilities?.youtube}
                              onClick={() => handlePublish(a.id, ['youtube'])}
                              style={{ padding: '0.25rem 0.55rem', fontSize: '0.65rem' }}>
                              {publishing === a.id ? '…' : '▶ YT'}
                            </button>
                          </div>
                        )}
                        {a.posted && <div style={{ fontSize: '0.62rem', color: 'var(--green, #2ecc71)', marginTop: '0.35rem' }}>✓ posted: {(a.postedTo || []).join(', ')}</div>}
                      </>
                    )}
                  </div>
                ))}
              </div>
            ) : !daily?.generating?.active && (
              <div style={{ opacity: 0.6, fontSize: '0.85rem', padding: '1rem 0' }}>
                No draft yet for today. Hit <b>REFRESH TOOLS</b> to pull the latest launches, then <b>GENERATE TODAY</b> to build the 5-tool rundown, 3 how-to reels, and 2 update posts.
              </div>
            )}
          </div>
        )}

        {/* ── AUTO SCHEDULER ── */}
        {activeTab === 'auto' && (
          <div className="panel scheduler-panel">
            <div className="scheduler-info">
              &gt; AUTONOMOUS MODE — system selects top viral AI news, generates carousel, deploys to Instagram.<br />
              &gt; TOPICS rotate: OpenAI · Anthropic · AI layoffs · Google AI · AI funding · and more.<br />
              &gt; NO human input required.
            </div>

            <div className="field">
              <label>POSTING FREQUENCY</label>
              <select value={cronExpression} onChange={(e) => setCronExpression(e.target.value)}>
                {CRON_PRESETS.map((p) => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </select>
            </div>

            <div className="scheduler-actions">
              <button className="btn btn-green" onClick={handleStartScheduler} disabled={schedulerStatus?.running}>
                ▶ START
              </button>
              <button className="btn btn-red" onClick={handleStopScheduler} disabled={!schedulerStatus?.running}>
                ■ STOP
              </button>
              <button className="btn btn-cyan" onClick={handleRunPipeline} disabled={loading.pipeline}>
                {loading.pipeline ? 'RUNNING...' : '⚡ RUN NOW'}
              </button>
            </div>

            {schedulerStatus && (
              <div className={`status-box ${schedulerStatus.running ? 'status-active' : ''}`}>
                <div className="status-row">
                  <span className="s-key">STATUS</span>
                  <span className="s-val">{schedulerStatus.running ? '🟢 ONLINE' : '🔴 OFFLINE'}</span>
                </div>
                <div className="status-divider" />
                {schedulerStatus.schedule && (
                  <div className="status-row">
                    <span className="s-key">SCHEDULE</span>
                    <span className="s-val">{CRON_PRESETS.find(p => p.value === schedulerStatus.schedule)?.label || schedulerStatus.schedule}</span>
                  </div>
                )}
                {schedulerStatus.nextTopic && (
                  <div className="status-row">
                    <span className="s-key">NEXT TOPIC</span>
                    <span className="s-val">{schedulerStatus.nextTopic}</span>
                  </div>
                )}
                {schedulerStatus.lastRun && (
                  <div className="status-row">
                    <span className="s-key">LAST RUN</span>
                    <span className="s-val">{new Date(schedulerStatus.lastRun).toLocaleString()}</span>
                  </div>
                )}
                {schedulerStatus.totalPosted > 0 && (
                  <div className="status-row">
                    <span className="s-key">TOTAL POSTED</span>
                    <span className="s-val" style={{ color: 'var(--green)' }}>{schedulerStatus.totalPosted}</span>
                  </div>
                )}
                {schedulerStatus.lastResult && (
                  <div className="status-row">
                    <span className="s-key">LAST POST</span>
                    <span className="s-val">
                      {schedulerStatus.lastResult.success
                        ? `✓ "${schedulerStatus.lastResult.article?.slice(0, 60)}..."`
                        : `✗ ${schedulerStatus.lastResult.error}`}
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
