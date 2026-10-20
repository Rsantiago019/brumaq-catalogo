'use strict';
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const config = require('./config');

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
fs.mkdirSync(config.uploadDir, { recursive: true });

const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

/* ---------------------------------------------------------------
   ESQUEMA
   - users:          cuentas del panel. SOLO se guarda el hash de la contraseña.
   - categories:     tipos de producto (Tractores, Trilladoras, Cosechadoras...).
   - products:       fichas del catálogo. No existe ninguna columna de precio.
   - product_images: imágenes de cada producto (varias por producto, ordenables).
   --------------------------------------------------------------- */
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  email          TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  password_hash  TEXT    NOT NULL,                       -- bcrypt ($2b$12$...)
  role           TEXT    NOT NULL DEFAULT 'admin' CHECK (role IN ('admin','editor')),
  token_version  INTEGER NOT NULL DEFAULT 0,             -- subirlo invalida las sesiones activas
  last_login_at  TEXT,
  created_at     TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT    NOT NULL UNIQUE,
  expires_at TEXT    NOT NULL,
  created_at TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user ON password_reset_tokens(user_id);

CREATE TABLE IF NOT EXISTS categories (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  slug       TEXT    NOT NULL UNIQUE,
  position   INTEGER NOT NULL DEFAULT 0,
  created_at TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS products (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL,
  slug        TEXT    NOT NULL UNIQUE,
  category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
  description TEXT    NOT NULL DEFAULT '',
  specs       TEXT    NOT NULL DEFAULT '[]',              -- JSON: [{"label":"Potencia","value":"120 HP"}]
  status      TEXT    NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_at  TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_products_category_status ON products(category_id, status);

CREATE TABLE IF NOT EXISTS product_images (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  filename   TEXT    NOT NULL,
  position   INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_images_product ON product_images(product_id, position);
`);

module.exports = db;
