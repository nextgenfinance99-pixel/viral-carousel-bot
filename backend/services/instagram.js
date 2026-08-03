const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');

const BASE_URL = 'https://graph.instagram.com/v19.0';

function getCredentials() {
  // Token comes from the self-refreshing store, not straight from .env — a
  // refreshed token is a new string and would otherwise be lost on restart.
  const accessToken = require('./instagramToken').getToken();
  const userId = process.env.INSTAGRAM_USER_ID;
  if (!accessToken || !userId) throw new Error('Instagram credentials not configured in .env');
  return { accessToken, userId };
}

// ── PUBLIC FILE HOSTING ───────────────────────────────────────────────────────
// Instagram fetches media by URL, so every asset needs a temporary public link.
// Providers are tried in order — catbox started returning 412 "Invalid uploader"
// for anonymous uploads, so it is no longer the primary. Each provider only has
// to outlive the container transcode (a couple of minutes), not the post itself.
const FILE_HOSTS = [
  {
    name: 'litterbox',
    async upload(filepath) {
      const form = new FormData();
      form.append('reqtype', 'fileupload');
      form.append('time', '72h');
      form.append('fileToUpload', fs.createReadStream(filepath));
      const res = await axios.post('https://litterbox.catbox.moe/resources/internals/api.php', form, {
        headers: form.getHeaders(), timeout: 120000,
        maxBodyLength: Infinity, maxContentLength: Infinity,
      });
      const url = String(res.data).trim();
      if (!/^https?:\/\//.test(url)) throw new Error(url.slice(0, 120));
      return url;
    },
  },
  {
    name: 'tmpfiles',
    async upload(filepath) {
      const form = new FormData();
      form.append('file', fs.createReadStream(filepath));
      const res = await axios.post('https://tmpfiles.org/api/v1/upload', form, {
        headers: form.getHeaders(), timeout: 120000,
        maxBodyLength: Infinity, maxContentLength: Infinity,
      });
      const page = res.data?.data?.url;
      if (!page) throw new Error(JSON.stringify(res.data).slice(0, 120));
      // The API returns a viewer page; IG needs the direct file, which lives under /dl/.
      return page.replace('tmpfiles.org/', 'tmpfiles.org/dl/');
    },
  },
  {
    name: 'catbox',
    async upload(filepath) {
      const form = new FormData();
      form.append('reqtype', 'fileupload');
      form.append('fileToUpload', fs.createReadStream(filepath));
      const res = await axios.post('https://catbox.moe/user/api.php', form, {
        headers: form.getHeaders(), timeout: 120000,
        maxBodyLength: Infinity, maxContentLength: Infinity,
      });
      const url = String(res.data).trim();
      if (!/^https?:\/\//.test(url)) throw new Error(url.slice(0, 120));
      return url;
    },
  },
];

// Upload any file (image or mp4) and return a public URL Instagram can fetch.
async function uploadFileToHost(filepath) {
  const failures = [];
  for (const host of FILE_HOSTS) {
    try {
      const url = await host.upload(filepath);
      console.log(`[Instagram] Uploaded via ${host.name} → ${url}`);
      return url;
    } catch (e) {
      const why = e.response ? `${e.response.status} ${String(e.response.data).slice(0, 60)}` : e.message;
      console.log(`[Instagram] Host ${host.name} failed: ${why}`);
      failures.push(`${host.name}: ${why}`);
    }
  }
  throw new Error(`All file hosts failed — ${failures.join(' | ')}`);
}

const uploadImageToHost = uploadFileToHost;

// Create a single carousel item container (not published on its own)
async function createCarouselItem(imageUrl) {
  const { accessToken, userId } = getCredentials();
  const res = await axios.post(`${BASE_URL}/${userId}/media`, null, {
    params: {
      image_url: imageUrl,
      media_type: 'IMAGE',
      is_carousel_item: true,
      access_token: accessToken,
    },
  });
  return res.data.id;
}

// Create the carousel album container
async function createCarouselContainer(childIds, caption) {
  const { accessToken, userId } = getCredentials();
  const res = await axios.post(`${BASE_URL}/${userId}/media`, null, {
    params: {
      media_type: 'CAROUSEL',
      children: childIds.join(','),
      caption,
      access_token: accessToken,
    },
  });
  return res.data.id;
}

// Publish the carousel
async function publishMedia(containerId) {
  const { accessToken, userId } = getCredentials();
  try {
    const res = await axios.post(`${BASE_URL}/${userId}/media_publish`, null, {
      params: {
        creation_id: containerId,
        access_token: accessToken,
      },
    });
    return res.data.id;
  } catch (e) {
    throw apiError(e, 'Publishing failed');
  }
}

async function postCarousel(imagePaths, caption) {
  console.log(`[Instagram] Uploading ${imagePaths.length} images...`);

  // Upload all images to public host
  const imageUrls = [];
  for (const fp of imagePaths) {
    const url = await uploadImageToHost(fp);
    imageUrls.push(url);
  }

  // Create individual carousel item containers
  const childIds = [];
  for (const url of imageUrls) {
    const id = await createCarouselItem(url);
    childIds.push(id);
    console.log(`[Instagram] Carousel item created: ${id}`);
    await new Promise((r) => setTimeout(r, 1000));
  }

  // Create carousel container
  const carouselId = await createCarouselContainer(childIds, caption);
  console.log(`[Instagram] Carousel container: ${carouselId}`);

  // Wait before publishing (Instagram recommendation)
  await new Promise((r) => setTimeout(r, 3000));

  const postId = await publishMedia(carouselId);
  console.log(`[Instagram] Published carousel: ${postId}`);
  return postId;
}

// Post a single vertical video as a Reel. IG processes the video async, so we
// create the REELS container, poll until it's FINISHED, then publish.
// Turn Graph API errors into something readable. A bare "status code 400" gives
// no clue that, say, the access token expired overnight.
function apiError(e, stage) {
  const err = e.response?.data?.error;
  if (!err) return new Error(`${stage}: ${e.message}`);
  const expired = err.code === 190;
  return new Error(
    `${stage}: ${err.message}${err.code ? ` (code ${err.code})` : ''}` +
    (expired ? ' — the Instagram token needs regenerating in the Meta app' : '')
  );
}

async function postReel(videoPath, caption) {
  const { accessToken, userId } = getCredentials();
  const videoUrl = await uploadFileToHost(videoPath);

  console.log('[Instagram] Creating REELS container...');
  let create;
  try {
    create = await axios.post(`${BASE_URL}/${userId}/media`, null, {
      params: { media_type: 'REELS', video_url: videoUrl, caption, access_token: accessToken },
    });
  } catch (e) {
    throw apiError(e, 'Creating reel container failed');
  }
  const containerId = create.data.id;

  // Poll container status (video transcode can take a while)
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const st = await axios.get(`${BASE_URL}/${containerId}`, {
      params: { fields: 'status_code,status', access_token: accessToken },
    });
    const code = st.data.status_code;
    console.log(`[Instagram] Reel container status: ${code}`);
    if (code === 'FINISHED') break;
    if (code === 'ERROR') throw new Error(`Reel processing failed: ${st.data.status || ''}`);
    if (i === 29) throw new Error('Reel processing timed out');
  }

  const postId = await publishMedia(containerId);
  console.log(`[Instagram] Published Reel: ${postId}`);
  return postId;
}

module.exports = { postCarousel, postReel };
