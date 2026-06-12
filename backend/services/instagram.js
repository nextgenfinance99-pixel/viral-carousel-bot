const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');

const BASE_URL = 'https://graph.instagram.com/v19.0';

function getCredentials() {
  const accessToken = process.env.INSTAGRAM_ACCESS_TOKEN;
  const userId = process.env.INSTAGRAM_USER_ID;
  if (!accessToken || !userId) throw new Error('Instagram credentials not configured in .env');
  return { accessToken, userId };
}

// Upload image to catbox.moe (free, no auth, permanent hosting)
async function uploadImageToHost(filepath) {
  const form = new FormData();
  form.append('reqtype', 'fileupload');
  form.append('fileToUpload', fs.createReadStream(filepath));
  const res = await axios.post('https://catbox.moe/user/api.php', form, {
    headers: form.getHeaders(),
    timeout: 30000,
  });
  const url = res.data.trim();
  console.log(`[Instagram] Uploaded image → ${url}`);
  return url;
}

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
  const res = await axios.post(`${BASE_URL}/${userId}/media_publish`, null, {
    params: {
      creation_id: containerId,
      access_token: accessToken,
    },
  });
  return res.data.id;
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

// Upload any file (incl. mp4) to catbox.moe — IG needs a public URL to fetch.
async function uploadFileToHost(filepath) {
  const form = new FormData();
  form.append('reqtype', 'fileupload');
  form.append('fileToUpload', fs.createReadStream(filepath));
  const res = await axios.post('https://catbox.moe/user/api.php', form, {
    headers: form.getHeaders(), timeout: 120000, maxBodyLength: Infinity, maxContentLength: Infinity,
  });
  const url = res.data.trim();
  console.log(`[Instagram] Uploaded file → ${url}`);
  return url;
}

// Post a single vertical video as a Reel. IG processes the video async, so we
// create the REELS container, poll until it's FINISHED, then publish.
async function postReel(videoPath, caption) {
  const { accessToken, userId } = getCredentials();
  const videoUrl = await uploadFileToHost(videoPath);

  console.log('[Instagram] Creating REELS container...');
  const create = await axios.post(`${BASE_URL}/${userId}/media`, null, {
    params: { media_type: 'REELS', video_url: videoUrl, caption, access_token: accessToken },
  });
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
