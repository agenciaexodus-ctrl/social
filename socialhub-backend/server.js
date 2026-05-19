require('dotenv').config();
const express = require('express');
const session = require('express-session');
const cors = require('cors');
const helmet = require('helmet');

const authRoutes    = require('./routes/auth');
const apiRoutes     = require('./routes/api');
const publishRoutes = require('./routes/publish');
const { startScheduler } = require('./config/scheduler');

const app  = express();
const PORT = process.env.PORT || 3001;

// ── Segurança & Middlewares ───────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({
  origin: [
    process.env.FRONTEND_URL,
    'http://localhost:3000',
    'http://localhost:5500',
    /\.railway\.app$/
  ],
  credentials: true
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-secret-change-in-prod',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000 // 24h
  }
}));

// ── Rotas ─────────────────────────────────────────────────────
app.use('/auth',    authRoutes);
app.use('/api',     apiRoutes);
app.use('/publish', publishRoutes);

// Health check (Railway usa isso para verificar se o servidor está online)
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    env: process.env.NODE_ENV
  });
});

// Página inicial (útil para confirmar que o deploy funcionou)
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">
    <title>SocialHub Pro — Backend</title>
    <style>body{font-family:system-ui;display:flex;align-items:center;justify-content:center;
      min-height:100vh;margin:0;background:#0f172a;color:#f1f5f9}
      .card{text-align:center;padding:40px}.h1{font-size:32px;font-weight:700;color:#6366f1}
      .sub{color:#64748b;margin-top:8px}.badge{background:#10b98120;color:#10b981;
      padding:6px 14px;border-radius:20px;font-size:13px;margin-top:20px;display:inline-block}
    </style></head><body>
    <div class="card">
      <div class="h1">⚡ SocialHub Pro</div>
      <div class="sub">Backend rodando com sucesso</div>
      <div class="badge">● Online — ${new Date().toLocaleString('pt-BR')}</div>
      <div style="margin-top:24px;font-size:13px;color:#475569">
        <p>Endpoints disponíveis:</p>
        <code style="color:#a5b4fc">GET /health · /api/clients · /api/posts</code><br>
        <code style="color:#a5b4fc">GET /auth/status/:clientId</code><br>
        <code style="color:#a5b4fc">GET /auth/facebook|instagram|linkedin|tiktok/connect/:clientId</code>
      </div>
    </div></body></html>
  `);
});

// ── Error handler ─────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('Erro não tratado:', err.stack);
  res.status(500).json({ error: 'Erro interno do servidor', message: err.message });
});

// ── Iniciar ───────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🚀 SocialHub Backend rodando na porta ${PORT}`);
  console.log(`   Ambiente: ${process.env.NODE_ENV || 'development'}`);
  console.log(`   Frontend: ${process.env.FRONTEND_URL || 'não configurado'}\n`);
  startScheduler();
});

module.exports = app;
