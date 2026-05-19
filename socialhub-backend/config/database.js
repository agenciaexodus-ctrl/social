const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, '../socialhub.db'));

// Ativar WAL para melhor performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ─── CRIAR TABELAS ───────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS clients (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    contact     TEXT,
    email       TEXT,
    phone       TEXT,
    niche       TEXT,
    color       TEXT DEFAULT '#6366f1',
    notes       TEXT,
    active      INTEGER DEFAULT 1,
    approval_link TEXT,
    created_at  TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS social_tokens (
    id            TEXT PRIMARY KEY,
    client_id     TEXT NOT NULL,
    platform      TEXT NOT NULL,
    access_token  TEXT NOT NULL,
    refresh_token TEXT,
    expires_at    TEXT,
    account_name  TEXT,
    account_id    TEXT,
    page_id       TEXT,
    page_name     TEXT,
    created_at    TEXT DEFAULT (datetime('now')),
    updated_at    TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
    UNIQUE(client_id, platform)
  );

  CREATE TABLE IF NOT EXISTS posts (
    id          TEXT PRIMARY KEY,
    client_id   TEXT NOT NULL,
    platforms   TEXT DEFAULT '[]',
    content     TEXT,
    media_url   TEXT,
    format      TEXT,
    status      TEXT DEFAULT 'draft',
    scheduled_at TEXT,
    published_at TEXT,
    notes       TEXT,
    results     TEXT DEFAULT '{}',
    created_at  TEXT DEFAULT (datetime('now')),
    updated_at  TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS tasks (
    id          TEXT PRIMARY KEY,
    client_id   TEXT,
    title       TEXT NOT NULL,
    description TEXT,
    responsible TEXT,
    priority    TEXT DEFAULT 'medium',
    status      TEXT DEFAULT 'todo',
    deadline    TEXT,
    created_at  TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS financial (
    id          TEXT PRIMARY KEY,
    client_id   TEXT,
    type        TEXT NOT NULL,
    value       REAL NOT NULL,
    description TEXT NOT NULL,
    date        TEXT,
    created_at  TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS crm (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    company     TEXT,
    email       TEXT,
    phone       TEXT,
    stage       TEXT DEFAULT 'prospecto',
    value       REAL DEFAULT 0,
    notes       TEXT,
    created_at  TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS personas (
    id          TEXT PRIMARY KEY,
    client_id   TEXT UNIQUE NOT NULL,
    data        TEXT DEFAULT '{}',
    updated_at  TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS competitors (
    id            TEXT PRIMARY KEY,
    client_id     TEXT,
    name          TEXT NOT NULL,
    ig_followers  TEXT,
    li_followers  TEXT,
    frequency     TEXT,
    engagement    TEXT,
    notes         TEXT,
    created_at    TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS oauth_states (
    state       TEXT PRIMARY KEY,
    client_id   TEXT NOT NULL,
    platform    TEXT NOT NULL,
    expires_at  TEXT NOT NULL
  );
`);

// Limpar estados OAuth expirados periodicamente
setInterval(() => {
  db.prepare("DELETE FROM oauth_states WHERE expires_at < datetime('now')").run();
}, 1000 * 60 * 10);

module.exports = db;
