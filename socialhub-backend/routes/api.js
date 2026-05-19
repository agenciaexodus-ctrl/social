const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../config/database');

// ── Helpers ──────────────────────────────────────────────────
const ok = (res, data) => res.json({ success: true, ...data });
const notFound = (res, msg = 'Não encontrado') => res.status(404).json({ error: msg });

// ════════════════════════════════════════════════════
//   CLIENTES
// ════════════════════════════════════════════════════

router.get('/clients', (req, res) => {
  const rows = db.prepare('SELECT * FROM clients ORDER BY created_at DESC').all();
  ok(res, { clients: rows });
});

router.get('/clients/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id);
  if (!row) return notFound(res, 'Cliente não encontrado');
  ok(res, { client: row });
});

router.post('/clients', (req, res) => {
  const total = db.prepare('SELECT COUNT(*) as n FROM clients').get().n;
  if (total >= 30) return res.status(400).json({ error: 'Limite de 30 clientes atingido' });

  const { name, contact, email, phone, niche, color, notes } = req.body;
  if (!name) return res.status(400).json({ error: 'Nome é obrigatório' });

  const id = uuidv4();
  const approvalLink = `${process.env.FRONTEND_URL}/approve/${id}`;

  db.prepare(`
    INSERT INTO clients (id, name, contact, email, phone, niche, color, notes, approval_link)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, name, contact || null, email || null, phone || null, niche || null,
         color || '#6366f1', notes || null, approvalLink);

  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(id);
  ok(res, { client });
});

router.put('/clients/:id', (req, res) => {
  const { name, contact, email, phone, niche, color, notes, active } = req.body;
  const existing = db.prepare('SELECT id FROM clients WHERE id = ?').get(req.params.id);
  if (!existing) return notFound(res, 'Cliente não encontrado');

  db.prepare(`
    UPDATE clients SET name=?, contact=?, email=?, phone=?, niche=?, color=?, notes=?, active=?
    WHERE id=?
  `).run(name, contact || null, email || null, phone || null, niche || null,
         color || '#6366f1', notes || null, active !== undefined ? (active ? 1 : 0) : 1,
         req.params.id);

  ok(res, { client: db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id) });
});

router.delete('/clients/:id', (req, res) => {
  const n = db.prepare('DELETE FROM clients WHERE id = ?').run(req.params.id);
  if (!n.changes) return notFound(res, 'Cliente não encontrado');
  ok(res, { message: 'Cliente removido' });
});

// ════════════════════════════════════════════════════
//   POSTS
// ════════════════════════════════════════════════════

router.get('/posts', (req, res) => {
  const { clientId, status } = req.query;
  let sql = 'SELECT * FROM posts WHERE 1=1';
  const params = [];
  if (clientId) { sql += ' AND client_id = ?'; params.push(clientId); }
  if (status)   { sql += ' AND status = ?';    params.push(status); }
  sql += ' ORDER BY created_at DESC';
  ok(res, { posts: db.prepare(sql).all(...params) });
});

router.post('/posts', (req, res) => {
  const { clientId, platforms, content, mediaUrl, format, status, scheduledAt, notes } = req.body;
  if (!clientId) return res.status(400).json({ error: 'clientId é obrigatório' });

  const id = uuidv4();
  db.prepare(`
    INSERT INTO posts (id, client_id, platforms, content, media_url, format, status, scheduled_at, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, clientId, JSON.stringify(platforms || []), content || null,
         mediaUrl || null, format || 'Feed — Imagem', status || 'draft',
         scheduledAt || null, notes || null);

  ok(res, { post: db.prepare('SELECT * FROM posts WHERE id = ?').get(id) });
});

router.put('/posts/:id', (req, res) => {
  const { platforms, content, mediaUrl, format, status, scheduledAt, notes } = req.body;
  const existing = db.prepare('SELECT id FROM posts WHERE id = ?').get(req.params.id);
  if (!existing) return notFound(res, 'Post não encontrado');

  db.prepare(`
    UPDATE posts SET platforms=?, content=?, media_url=?, format=?, status=?,
    scheduled_at=?, notes=?, updated_at=datetime('now') WHERE id=?
  `).run(JSON.stringify(platforms || []), content || null, mediaUrl || null,
         format || 'Feed — Imagem', status || 'draft', scheduledAt || null,
         notes || null, req.params.id);

  ok(res, { post: db.prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id) });
});

router.delete('/posts/:id', (req, res) => {
  const n = db.prepare('DELETE FROM posts WHERE id = ?').run(req.params.id);
  if (!n.changes) return notFound(res);
  ok(res, { message: 'Post excluído' });
});

// Rota de aprovação
router.post('/posts/:id/approve', (req, res) => {
  db.prepare("UPDATE posts SET status='approved', updated_at=datetime('now') WHERE id=?")
    .run(req.params.id);
  ok(res, { message: 'Post aprovado' });
});

router.post('/posts/:id/reject', (req, res) => {
  db.prepare("UPDATE posts SET status='draft', updated_at=datetime('now') WHERE id=?")
    .run(req.params.id);
  ok(res, { message: 'Post devolvido para revisão' });
});

// ════════════════════════════════════════════════════
//   TAREFAS
// ════════════════════════════════════════════════════

router.get('/tasks', (req, res) => {
  ok(res, { tasks: db.prepare('SELECT * FROM tasks ORDER BY created_at DESC').all() });
});

router.post('/tasks', (req, res) => {
  const { clientId, title, description, responsible, priority, deadline } = req.body;
  if (!title) return res.status(400).json({ error: 'Título é obrigatório' });
  const id = uuidv4();
  db.prepare(`
    INSERT INTO tasks (id, client_id, title, description, responsible, priority, deadline)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, clientId || null, title, description || null,
         responsible || null, priority || 'medium', deadline || null);
  ok(res, { task: db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) });
});

router.put('/tasks/:id', (req, res) => {
  const { title, description, responsible, priority, status, deadline } = req.body;
  db.prepare(`
    UPDATE tasks SET title=?, description=?, responsible=?, priority=?, status=?, deadline=?
    WHERE id=?
  `).run(title, description || null, responsible || null,
         priority || 'medium', status || 'todo', deadline || null, req.params.id);
  ok(res, { task: db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id) });
});

router.delete('/tasks/:id', (req, res) => {
  db.prepare('DELETE FROM tasks WHERE id = ?').run(req.params.id);
  ok(res, { message: 'Tarefa removida' });
});

// ════════════════════════════════════════════════════
//   FINANCEIRO
// ════════════════════════════════════════════════════

router.get('/financial', (req, res) => {
  const rows = db.prepare('SELECT * FROM financial ORDER BY date DESC, created_at DESC').all();
  const receita = rows.filter(r => r.type === 'receita').reduce((s, r) => s + r.value, 0);
  const despesa = rows.filter(r => r.type === 'despesa').reduce((s, r) => s + r.value, 0);
  ok(res, { entries: rows, summary: { receita, despesa, resultado: receita - despesa } });
});

router.post('/financial', (req, res) => {
  const { clientId, type, value, description, date } = req.body;
  if (!type || !value || !description) return res.status(400).json({ error: 'Campos obrigatórios: type, value, description' });
  const id = uuidv4();
  db.prepare('INSERT INTO financial (id, client_id, type, value, description, date) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, clientId || null, type, parseFloat(value), description, date || new Date().toISOString().split('T')[0]);
  ok(res, { entry: db.prepare('SELECT * FROM financial WHERE id = ?').get(id) });
});

router.delete('/financial/:id', (req, res) => {
  db.prepare('DELETE FROM financial WHERE id = ?').run(req.params.id);
  ok(res, { message: 'Lançamento removido' });
});

// ════════════════════════════════════════════════════
//   CRM
// ════════════════════════════════════════════════════

router.get('/crm', (req, res) => {
  ok(res, { leads: db.prepare('SELECT * FROM crm ORDER BY created_at DESC').all() });
});

router.post('/crm', (req, res) => {
  const { name, company, email, phone, stage, value, notes } = req.body;
  if (!name) return res.status(400).json({ error: 'Nome é obrigatório' });
  const id = uuidv4();
  db.prepare('INSERT INTO crm (id, name, company, email, phone, stage, value, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, name, company || null, email || null, phone || null,
         stage || 'prospecto', parseFloat(value) || 0, notes || null);
  ok(res, { lead: db.prepare('SELECT * FROM crm WHERE id = ?').get(id) });
});

router.put('/crm/:id', (req, res) => {
  const { name, company, email, phone, stage, value, notes } = req.body;
  db.prepare('UPDATE crm SET name=?, company=?, email=?, phone=?, stage=?, value=?, notes=? WHERE id=?')
    .run(name, company || null, email || null, phone || null,
         stage || 'prospecto', parseFloat(value) || 0, notes || null, req.params.id);
  ok(res, { lead: db.prepare('SELECT * FROM crm WHERE id = ?').get(req.params.id) });
});

router.delete('/crm/:id', (req, res) => {
  db.prepare('DELETE FROM crm WHERE id = ?').run(req.params.id);
  ok(res, { message: 'Lead removido' });
});

// ════════════════════════════════════════════════════
//   PERSONAS & CONCORRENTES
// ════════════════════════════════════════════════════

router.get('/personas/:clientId', (req, res) => {
  const row = db.prepare('SELECT * FROM personas WHERE client_id = ?').get(req.params.clientId);
  ok(res, { persona: row ? JSON.parse(row.data) : {} });
});

router.put('/personas/:clientId', (req, res) => {
  const existing = db.prepare('SELECT id FROM personas WHERE client_id = ?').get(req.params.clientId);
  const data = JSON.stringify(req.body);
  if (existing) {
    db.prepare("UPDATE personas SET data=?, updated_at=datetime('now') WHERE client_id=?")
      .run(data, req.params.clientId);
  } else {
    db.prepare('INSERT INTO personas (id, client_id, data) VALUES (?, ?, ?)')
      .run(uuidv4(), req.params.clientId, data);
  }
  ok(res, { message: 'Persona salva' });
});

router.get('/competitors', (req, res) => {
  const { clientId } = req.query;
  let sql = 'SELECT * FROM competitors';
  const params = [];
  if (clientId) { sql += ' WHERE client_id = ?'; params.push(clientId); }
  ok(res, { competitors: db.prepare(sql).all(...params) });
});

router.post('/competitors', (req, res) => {
  const { clientId, name, igFollowers, liFollowers, frequency, engagement, notes } = req.body;
  if (!name) return res.status(400).json({ error: 'Nome é obrigatório' });
  const id = uuidv4();
  db.prepare('INSERT INTO competitors (id, client_id, name, ig_followers, li_followers, frequency, engagement, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, clientId || null, name, igFollowers || null, liFollowers || null,
         frequency || null, engagement || null, notes || null);
  ok(res, { competitor: db.prepare('SELECT * FROM competitors WHERE id = ?').get(id) });
});

router.delete('/competitors/:id', (req, res) => {
  db.prepare('DELETE FROM competitors WHERE id = ?').run(req.params.id);
  ok(res, { message: 'Concorrente removido' });
});

module.exports = router;
