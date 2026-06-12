import axios from 'axios';

const api = axios.create({ baseURL: import.meta.env.VITE_API_URL || 'http://localhost:3001/api' });

export const fetchNews = (topic, exclude = []) =>
  api.post('/scrape', { topic, exclude }).then((r) => r.data.article);

export const generateCustomSlides = (title, body, imageFile) => {
  const form = new FormData();
  form.append('title', title);
  form.append('body', body);
  if (imageFile) form.append('image', imageFile);
  return api.post('/generate-custom', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  }).then((r) => r.data);
};

export const generateSlides = (article, topic) =>
  api.post('/generate', { article, topic }).then((r) => r.data);

// Reel generator — payload is one of { tool }, { topic }, { trending: true }
// plus optional host: 'auto' | 'boy' | 'girl' | 'none'
export const generateReel = (payload) =>
  api.post('/reel/generate', payload, { timeout: 180000 }).then((r) => r.data);

// Upload a host/avatar image. slot: 'host' | 'boy' | 'girl'
export const uploadReelAsset = (slot, imageFile) => {
  const form = new FormData();
  form.append('slot', slot);
  form.append('image', imageFile);
  return api.post('/reel/asset', form, { headers: { 'Content-Type': 'multipart/form-data' } }).then((r) => r.data);
};

export const getReelAssets = ()        => api.get('/reel/assets').then((r) => r.data);
export const getReelIntro  = ()        => api.get('/reel/intro').then((r) => r.data);
export const saveReelIntro = (payload) => api.post('/reel/intro', payload).then((r) => r.data);

export const postCarousel = (imagePaths, caption, articleUrl) =>
  api.post('/instagram/carousel', { imagePaths, caption, articleUrl }).then((r) => r.data);

export const runPipeline = () =>
  api.post('/scheduler/run').then((r) => r.data);

export const getQueue    = ()             => api.get('/queue').then((r) => r.data);
export const addToQueue  = (payload)      => api.post('/queue', payload).then((r) => r.data);
export const removeFromQueue = (id)       => api.delete(`/queue/${id}`).then((r) => r.data);

export const startScheduler = (cronExpression) =>
  api.post('/scheduler/start', { cronExpression }).then((r) => r.data);

export const stopScheduler = () =>
  api.post('/scheduler/stop').then((r) => r.data);

export const getSchedulerStatus = () =>
  api.get('/scheduler/status').then((r) => r.data);

export const getTrending = () =>
  api.get('/trending').then((r) => r.data.stories);

// ── Daily AI-tools challenge ──────────────────────────────────────────────────
export const getDailyStatus = ()        => api.get('/daily/status').then((r) => r.data);
export const getDailyDraft   = (date)    => api.get('/daily/draft', { params: { date } }).then((r) => r.data);
export const ingestTools     = ()        => api.post('/daily/ingest').then((r) => r.data);
export const generateDaily   = (payload) => api.post('/daily/generate', payload || {}).then((r) => r.data);
export const approveAsset    = (date, assetId, approved) =>
  api.post('/daily/approve', { date, assetId, approved }).then((r) => r.data);
export const publishAsset    = (date, assetId, targets) =>
  api.post('/daily/publish', { date, assetId, targets }, { timeout: 600000 }).then((r) => r.data);
