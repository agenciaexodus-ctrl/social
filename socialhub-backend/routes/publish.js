const express = require('express');
const router = express.Router();
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const db = require('../config/database');
const { getToken } = require('./auth');

// ════════════════════════════════════════════════════
//   PUBLICAR POST (todas as plataformas selecionadas)
// ════════════════════════════════════════════════════

router.post('/publish/:postId', async (req, res) => {
  const { postId } = req.params;

  const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(postId);
  if (!post) return res.status(404).json({ error: 'Post não encontrado' });

  const platforms = JSON.parse(post.platforms || '[]');
  const results = {};

  for (const platform of platforms) {
    try {
      const token = getToken(post.client_id, platform);
      if (!token) {
        results[platform] = { success: false, error: 'Conta não conectada' };
        continue;
      }

      let result;
      if (platform === 'facebook') result = await publishFacebook(post, token);
      if (platform === 'instagram') result = await publishInstagram(post, token);
      if (platform === 'linkedin') result = await publishLinkedIn(post, token);
      if (platform === 'tiktok') result = await publishTikTok(post, token);

      results[platform] = result;
    } catch (err) {
      console.error(`Erro ao publicar no ${platform}:`, err.message);
      results[platform] = { success: false, error: err.message };
    }
  }

  const allSuccess = Object.values(results).every(r => r.success);
  const anySuccess = Object.values(results).some(r => r.success);

  // Atualizar status do post
  const newStatus = allSuccess ? 'published' : anySuccess ? 'partial' : 'failed';
  db.prepare(`
    UPDATE posts SET status = ?, published_at = datetime('now'),
    results = ?, updated_at = datetime('now') WHERE id = ?
  `).run(newStatus, JSON.stringify(results), postId);

  res.json({ success: anySuccess, results, status: newStatus });
});


// ════════════════════════════════════════════════════
//   FACEBOOK — publicar na página
// ════════════════════════════════════════════════════

async function publishFacebook(post, token) {
  const pageId = token.page_id;
  if (!pageId) throw new Error('Nenhuma página do Facebook configurada');

  const body = { message: post.content, access_token: token.access_token };

  if (post.media_url) {
    // Post com imagem
    const photoRes = await axios.post(
      `https://graph.facebook.com/v19.0/${pageId}/photos`,
      { ...body, url: post.media_url, published: true }
    );
    return { success: true, id: photoRes.data.id, type: 'photo' };
  } else {
    // Post de texto
    const feedRes = await axios.post(
      `https://graph.facebook.com/v19.0/${pageId}/feed`,
      body
    );
    return { success: true, id: feedRes.data.id, type: 'text' };
  }
}


// ════════════════════════════════════════════════════
//   INSTAGRAM — publicar via Content Publishing API
// ════════════════════════════════════════════════════

async function publishInstagram(post, token) {
  const igId = token.account_id;
  if (!igId) throw new Error('ID da conta Instagram não encontrado');

  // Instagram exige mídia para publicar
  if (!post.media_url) {
    throw new Error('Instagram requer imagem ou vídeo para publicar');
  }

  // Passo 1: criar container de mídia
  const containerRes = await axios.post(
    `https://graph.facebook.com/v19.0/${igId}/media`,
    {
      image_url: post.media_url,
      caption: post.content,
      access_token: token.access_token
    }
  );
  const containerId = containerRes.data.id;

  // Passo 2: aguardar processamento
  await new Promise(resolve => setTimeout(resolve, 3000));

  // Passo 3: publicar o container
  const publishRes = await axios.post(
    `https://graph.facebook.com/v19.0/${igId}/media_publish`,
    { creation_id: containerId, access_token: token.access_token }
  );

  return { success: true, id: publishRes.data.id, type: 'image' };
}


// ════════════════════════════════════════════════════
//   LINKEDIN — publicar post
// ════════════════════════════════════════════════════

async function publishLinkedIn(post, token) {
  const authorUrn = `urn:li:person:${token.account_id}`;
  const headers = {
    Authorization: `Bearer ${token.access_token}`,
    'Content-Type': 'application/json',
    'X-Restli-Protocol-Version': '2.0.0'
  };

  let body;

  if (post.media_url) {
    // Post com imagem: primeiro registrar o upload
    const registerRes = await axios.post(
      'https://api.linkedin.com/v2/assets?action=registerUpload',
      {
        registerUploadRequest: {
          recipes: ['urn:li:digitalmediaRecipe:feedshare-image'],
          owner: authorUrn,
          serviceRelationships: [{
            relationshipType: 'OWNER',
            identifier: 'urn:li:userGeneratedContent'
          }]
        }
      },
      { headers }
    );

    const uploadUrl = registerRes.data.value.uploadMechanism
      ['com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest'].uploadUrl;
    const assetUrn = registerRes.data.value.asset;

    // Upload da imagem via URL
    const imageBuffer = await axios.get(post.media_url, { responseType: 'arraybuffer' });
    await axios.put(uploadUrl, imageBuffer.data, {
      headers: { Authorization: `Bearer ${token.access_token}`, 'Content-Type': 'image/jpeg' }
    });

    body = {
      author: authorUrn,
      lifecycleState: 'PUBLISHED',
      specificContent: {
        'com.linkedin.ugc.ShareContent': {
          shareCommentary: { text: post.content },
          shareMediaCategory: 'IMAGE',
          media: [{
            status: 'READY',
            description: { text: '' },
            media: assetUrn,
            title: { text: '' }
          }]
        }
      },
      visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' }
    };
  } else {
    body = {
      author: authorUrn,
      lifecycleState: 'PUBLISHED',
      specificContent: {
        'com.linkedin.ugc.ShareContent': {
          shareCommentary: { text: post.content },
          shareMediaCategory: 'NONE'
        }
      },
      visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' }
    };
  }

  const postRes = await axios.post('https://api.linkedin.com/v2/ugcPosts', body, { headers });
  return { success: true, id: postRes.headers['x-restli-id'], type: post.media_url ? 'image' : 'text' };
}


// ════════════════════════════════════════════════════
//   TIKTOK — publicar vídeo
// ════════════════════════════════════════════════════

async function publishTikTok(post, token) {
  if (!post.media_url) throw new Error('TikTok requer um vídeo para publicar');

  const headers = {
    Authorization: `Bearer ${token.access_token}`,
    'Content-Type': 'application/json'
  };

  // Iniciar upload via URL pública do vídeo
  const initRes = await axios.post(
    'https://open.tiktokapis.com/v2/post/publish/video/init/',
    {
      post_info: {
        title: post.content?.substring(0, 150) || '',
        privacy_level: 'PUBLIC_TO_EVERYONE',
        disable_duet: false,
        disable_comment: false,
        disable_stitch: false
      },
      source_info: {
        source: 'PULL_FROM_URL',
        video_url: post.media_url
      }
    },
    { headers }
  );

  const publishId = initRes.data.data?.publish_id;
  return { success: true, publish_id: publishId, type: 'video' };
}


module.exports = router;
