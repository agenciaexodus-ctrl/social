const express = require('express');
const router = express.Router();
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const db = require('../config/database');

// ════════════════════════════════════════════════════
//   UTILITÁRIOS
// ════════════════════════════════════════════════════

function saveToken(clientId, platform, data) {
  const existing = db.prepare(
    'SELECT id FROM social_tokens WHERE client_id = ? AND platform = ?'
  ).get(clientId, platform);

  if (existing) {
    db.prepare(`
      UPDATE social_tokens SET
        access_token  = ?,
        refresh_token = ?,
        expires_at    = ?,
        account_name  = ?,
        account_id    = ?,
        page_id       = ?,
        page_name     = ?,
        updated_at    = datetime('now')
      WHERE client_id = ? AND platform = ?
    `).run(
      data.access_token, data.refresh_token || null, data.expires_at || null,
      data.account_name || null, data.account_id || null,
      data.page_id || null, data.page_name || null,
      clientId, platform
    );
  } else {
    db.prepare(`
      INSERT INTO social_tokens (id, client_id, platform, access_token, refresh_token,
        expires_at, account_name, account_id, page_id, page_name)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      uuidv4(), clientId, platform,
      data.access_token, data.refresh_token || null, data.expires_at || null,
      data.account_name || null, data.account_id || null,
      data.page_id || null, data.page_name || null
    );
  }
}

function getToken(clientId, platform) {
  return db.prepare(
    'SELECT * FROM social_tokens WHERE client_id = ? AND platform = ?'
  ).get(clientId, platform);
}

function createOAuthState(clientId, platform) {
  const state = uuidv4();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 min
  db.prepare(
    'INSERT INTO oauth_states (state, client_id, platform, expires_at) VALUES (?, ?, ?, ?)'
  ).run(state, clientId, platform, expiresAt);
  return state;
}

function consumeOAuthState(state) {
  const row = db.prepare(
    "SELECT * FROM oauth_states WHERE state = ? AND expires_at > datetime('now')"
  ).get(state);
  if (row) db.prepare('DELETE FROM oauth_states WHERE state = ?').run(state);
  return row;
}

function closingPage(success, message, extra = '') {
  const color = success ? '#10b981' : '#ef4444';
  const icon = success ? '✓' : '✗';
  return `
    <!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">
    <title>${success ? 'Conectado!' : 'Erro'}</title>
    <style>
      body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;
        min-height:100vh;margin:0;background:#f8f9fb}
      .card{background:#fff;border-radius:16px;padding:40px;text-align:center;
        box-shadow:0 4px 24px rgba(0,0,0,.1);max-width:400px}
      .icon{font-size:48px;margin-bottom:12px}
      h2{color:${color};margin:0 0 8px}
      p{color:#64748b;font-size:14px}
      button{margin-top:20px;padding:10px 24px;background:${color};color:#fff;
        border:none;border-radius:8px;cursor:pointer;font-size:14px}
    </style></head><body>
    <div class="card">
      <div class="icon">${icon}</div>
      <h2>${success ? 'Conta conectada!' : 'Erro na conexão'}</h2>
      <p>${message}</p>
      ${extra}
      <button onclick="window.close()">Fechar</button>
    </div>
    <script>
      // Avisa a janela pai que a conexão foi feita
      if(window.opener) {
        window.opener.postMessage({type:'oauth_complete',success:${success}}, '*');
      }
      setTimeout(() => window.close(), 3000);
    </script>
    </body></html>`;
}

// ════════════════════════════════════════════════════
//   STATUS — quais plataformas estão conectadas
// ════════════════════════════════════════════════════

router.get('/status/:clientId', (req, res) => {
  const { clientId } = req.params;
  const tokens = db.prepare(
    'SELECT platform, account_name, page_name, updated_at FROM social_tokens WHERE client_id = ?'
  ).all(clientId);

  const status = {};
  ['instagram', 'facebook', 'linkedin', 'tiktok'].forEach(p => {
    const t = tokens.find(x => x.platform === p);
    status[p] = t
      ? { connected: true, account: t.account_name || t.page_name || 'Conectado', at: t.updated_at }
      : { connected: false };
  });

  res.json({ clientId, status });
});

// Desconectar uma plataforma
router.delete('/disconnect/:clientId/:platform', (req, res) => {
  const { clientId, platform } = req.params;
  db.prepare('DELETE FROM social_tokens WHERE client_id = ? AND platform = ?')
    .run(clientId, platform);
  res.json({ ok: true, message: `${platform} desconectado` });
});


// ════════════════════════════════════════════════════
//   FACEBOOK (inclui páginas para posts)
// ════════════════════════════════════════════════════

router.get('/facebook/connect/:clientId', (req, res) => {
  const state = createOAuthState(req.params.clientId, 'facebook');
  const scopes = [
    'pages_manage_posts', 'pages_read_engagement',
    'pages_show_list', 'public_profile'
  ].join(',');
  const url = `https://www.facebook.com/v19.0/dialog/oauth?`
    + `client_id=${process.env.FACEBOOK_APP_ID}`
    + `&redirect_uri=${encodeURIComponent(process.env.FACEBOOK_CALLBACK_URL)}`
    + `&scope=${encodeURIComponent(scopes)}`
    + `&state=${state}`;
  res.redirect(url);
});

router.get('/facebook/callback', async (req, res) => {
  const { code, state, error } = req.query;

  if (error) return res.send(closingPage(false, 'Autorização negada pelo usuário.'));

  const oauthState = consumeOAuthState(state);
  if (!oauthState) return res.send(closingPage(false, 'Estado OAuth inválido ou expirado.'));

  try {
    // Trocar code por token
    const tokenRes = await axios.get('https://graph.facebook.com/v19.0/oauth/access_token', {
      params: {
        client_id: process.env.FACEBOOK_APP_ID,
        client_secret: process.env.FACEBOOK_APP_SECRET,
        redirect_uri: process.env.FACEBOOK_CALLBACK_URL,
        code
      }
    });
    const userToken = tokenRes.data.access_token;

    // Buscar páginas do usuário
    const pagesRes = await axios.get('https://graph.facebook.com/v19.0/me/accounts', {
      params: { access_token: userToken, fields: 'id,name,access_token' }
    });

    let pageId = null, pageName = null, pageToken = userToken;
    if (pagesRes.data.data && pagesRes.data.data.length > 0) {
      const page = pagesRes.data.data[0]; // primeira página
      pageId = page.id;
      pageName = page.name;
      pageToken = page.access_token; // token de longa duração da página
    }

    // Info do usuário
    const meRes = await axios.get('https://graph.facebook.com/v19.0/me', {
      params: { access_token: userToken, fields: 'id,name' }
    });

    saveToken(oauthState.client_id, 'facebook', {
      access_token: pageToken,
      account_name: meRes.data.name,
      account_id: meRes.data.id,
      page_id: pageId,
      page_name: pageName
    });

    res.send(closingPage(true,
      `Facebook conectado! ${pageName ? `Página: <strong>${pageName}</strong>` : `Usuário: ${meRes.data.name}`}`
    ));
  } catch (err) {
    console.error('Facebook OAuth error:', err.response?.data || err.message);
    res.send(closingPage(false, 'Erro ao conectar Facebook. Verifique as credenciais do app.'));
  }
});


// ════════════════════════════════════════════════════
//   INSTAGRAM (via Meta Graph API)
// ════════════════════════════════════════════════════

router.get('/instagram/connect/:clientId', (req, res) => {
  const state = createOAuthState(req.params.clientId, 'instagram');
  const scopes = [
    'instagram_basic', 'instagram_content_publish',
    'instagram_manage_insights', 'pages_show_list',
    'pages_read_engagement', 'business_management'
  ].join(',');
  const url = `https://www.facebook.com/v19.0/dialog/oauth?`
    + `client_id=${process.env.INSTAGRAM_APP_ID}`
    + `&redirect_uri=${encodeURIComponent(process.env.INSTAGRAM_CALLBACK_URL)}`
    + `&scope=${encodeURIComponent(scopes)}`
    + `&state=${state}`;
  res.redirect(url);
});

router.get('/instagram/callback', async (req, res) => {
  const { code, state, error } = req.query;
  if (error) return res.send(closingPage(false, 'Autorização negada.'));

  const oauthState = consumeOAuthState(state);
  if (!oauthState) return res.send(closingPage(false, 'Estado OAuth inválido ou expirado.'));

  try {
    // Token do usuário
    const tokenRes = await axios.get('https://graph.facebook.com/v19.0/oauth/access_token', {
      params: {
        client_id: process.env.INSTAGRAM_APP_ID,
        client_secret: process.env.INSTAGRAM_APP_SECRET,
        redirect_uri: process.env.INSTAGRAM_CALLBACK_URL,
        code
      }
    });
    const userToken = tokenRes.data.access_token;

    // Buscar páginas do Facebook vinculadas
    const pagesRes = await axios.get('https://graph.facebook.com/v19.0/me/accounts', {
      params: { access_token: userToken, fields: 'id,name,access_token,instagram_business_account' }
    });

    let igId = null, igUsername = null, pageToken = userToken;
    for (const page of (pagesRes.data.data || [])) {
      if (page.instagram_business_account) {
        igId = page.instagram_business_account.id;
        pageToken = page.access_token;
        // Buscar username do Instagram
        const igRes = await axios.get(`https://graph.facebook.com/v19.0/${igId}`, {
          params: { access_token: pageToken, fields: 'id,username,name' }
        });
        igUsername = igRes.data.username || igRes.data.name;
        break;
      }
    }

    if (!igId) {
      return res.send(closingPage(false,
        'Nenhuma conta Instagram Business encontrada.<br>A conta precisa ser do tipo Business ou Creator e estar vinculada a uma Página do Facebook.'
      ));
    }

    saveToken(oauthState.client_id, 'instagram', {
      access_token: pageToken,
      account_name: igUsername ? `@${igUsername}` : igId,
      account_id: igId
    });

    res.send(closingPage(true, `Instagram conectado! Conta: <strong>@${igUsername || igId}</strong>`));
  } catch (err) {
    console.error('Instagram OAuth error:', err.response?.data || err.message);
    res.send(closingPage(false, 'Erro ao conectar Instagram. Verifique as configurações do app Meta.'));
  }
});


// ════════════════════════════════════════════════════
//   LINKEDIN
// ════════════════════════════════════════════════════

router.get('/linkedin/connect/:clientId', (req, res) => {
  const state = createOAuthState(req.params.clientId, 'linkedin');
  const scopes = 'openid profile email w_member_social';
  const url = `https://www.linkedin.com/oauth/v2/authorization?`
    + `response_type=code`
    + `&client_id=${process.env.LINKEDIN_CLIENT_ID}`
    + `&redirect_uri=${encodeURIComponent(process.env.LINKEDIN_CALLBACK_URL)}`
    + `&scope=${encodeURIComponent(scopes)}`
    + `&state=${state}`;
  res.redirect(url);
});

router.get('/linkedin/callback', async (req, res) => {
  const { code, state, error } = req.query;
  if (error) return res.send(closingPage(false, 'Autorização negada pelo LinkedIn.'));

  const oauthState = consumeOAuthState(state);
  if (!oauthState) return res.send(closingPage(false, 'Estado OAuth inválido ou expirado.'));

  try {
    // Trocar code por token
    const tokenRes = await axios.post(
      'https://www.linkedin.com/oauth/v2/accessToken',
      new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: process.env.LINKEDIN_CALLBACK_URL,
        client_id: process.env.LINKEDIN_CLIENT_ID,
        client_secret: process.env.LINKEDIN_CLIENT_SECRET
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );

    const accessToken = tokenRes.data.access_token;
    const expiresAt = new Date(Date.now() + tokenRes.data.expires_in * 1000).toISOString();

    // Buscar perfil
    const profileRes = await axios.get('https://api.linkedin.com/v2/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    const name = profileRes.data.name || profileRes.data.given_name || 'Usuário';
    const liId = profileRes.data.sub;

    saveToken(oauthState.client_id, 'linkedin', {
      access_token: accessToken,
      expires_at: expiresAt,
      account_name: name,
      account_id: liId
    });

    res.send(closingPage(true, `LinkedIn conectado! Perfil: <strong>${name}</strong>`));
  } catch (err) {
    console.error('LinkedIn OAuth error:', err.response?.data || err.message);
    res.send(closingPage(false, 'Erro ao conectar LinkedIn. Verifique as credenciais do app.'));
  }
});


// ════════════════════════════════════════════════════
//   TIKTOK
// ════════════════════════════════════════════════════

router.get('/tiktok/connect/:clientId', (req, res) => {
  const state = createOAuthState(req.params.clientId, 'tiktok');
  const scopes = 'user.info.basic,video.publish,video.upload';
  const url = `https://www.tiktok.com/v2/auth/authorize/?`
    + `client_key=${process.env.TIKTOK_CLIENT_KEY}`
    + `&response_type=code`
    + `&scope=${encodeURIComponent(scopes)}`
    + `&redirect_uri=${encodeURIComponent(process.env.TIKTOK_CALLBACK_URL)}`
    + `&state=${state}`;
  res.redirect(url);
});

router.get('/tiktok/callback', async (req, res) => {
  const { code, state, error } = req.query;
  if (error) return res.send(closingPage(false, 'Autorização negada pelo TikTok.'));

  const oauthState = consumeOAuthState(state);
  if (!oauthState) return res.send(closingPage(false, 'Estado OAuth inválido ou expirado.'));

  try {
    // Trocar code por token
    const tokenRes = await axios.post('https://open.tiktokapis.com/v2/oauth/token/', {
      client_key: process.env.TIKTOK_CLIENT_KEY,
      client_secret: process.env.TIKTOK_CLIENT_SECRET,
      code,
      grant_type: 'authorization_code',
      redirect_uri: process.env.TIKTOK_CALLBACK_URL
    }, { headers: { 'Content-Type': 'application/json' } });

    const { access_token, refresh_token, expires_in, open_id } = tokenRes.data.data;
    const expiresAt = new Date(Date.now() + expires_in * 1000).toISOString();

    // Buscar info do usuário
    const userRes = await axios.get('https://open.tiktokapis.com/v2/user/info/', {
      params: { fields: 'open_id,display_name,username,avatar_url' },
      headers: { Authorization: `Bearer ${access_token}` }
    });

    const user = userRes.data.data?.user;
    const displayName = user?.display_name || user?.username || open_id;

    saveToken(oauthState.client_id, 'tiktok', {
      access_token,
      refresh_token,
      expires_at: expiresAt,
      account_name: displayName,
      account_id: open_id
    });

    res.send(closingPage(true, `TikTok conectado! Conta: <strong>${displayName}</strong>`));
  } catch (err) {
    console.error('TikTok OAuth error:', err.response?.data || err.message);
    res.send(closingPage(false, 'Erro ao conectar TikTok. Verifique as credenciais do app.'));
  }
});


module.exports = router;
module.exports.getToken = getToken;
module.exports.saveToken = saveToken;
