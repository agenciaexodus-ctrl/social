const cron = require('node-cron');
const axios = require('axios');
const db = require('../config/database');

// Roda a cada minuto, verifica posts agendados para publicar
function startScheduler() {
  cron.schedule('* * * * *', async () => {
    const now = new Date().toISOString().slice(0, 16); // "2026-05-17T09:00"

    const scheduled = db.prepare(`
      SELECT * FROM posts
      WHERE status = 'scheduled'
        AND scheduled_at IS NOT NULL
        AND substr(scheduled_at, 1, 16) <= ?
    `).all(now);

    for (const post of scheduled) {
      console.log(`[Scheduler] Publicando post ${post.id} — ${post.client_id}`);
      try {
        await axios.post(`http://localhost:${process.env.PORT || 3001}/publish/${post.id}`);
        console.log(`[Scheduler] ✓ Post ${post.id} publicado`);
      } catch (err) {
        console.error(`[Scheduler] ✗ Erro ao publicar post ${post.id}:`, err.message);
        // Marcar como falho após 3 tentativas (simplificado)
        db.prepare("UPDATE posts SET status='failed' WHERE id=?").run(post.id);
      }
    }
  });

  console.log('[Scheduler] Agendamento automático iniciado (verificação a cada minuto)');
}

module.exports = { startScheduler };
