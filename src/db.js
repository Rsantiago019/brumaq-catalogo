'use strict';
const { Pool } = require('pg');
const config = require('./config');

const pool = globalThis.__brumaqPool || new Pool({
  connectionString: config.databaseUrl,
  max: 3,
  idleTimeoutMillis: 10000,
  connectionTimeoutMillis: 10000,
  ssl: config.databaseUrl.includes('localhost') ? false : { rejectUnauthorized: true }
});
globalThis.__brumaqPool = pool;
pool.on('error', error => {
  console.error('[DATABASE] Error inesperado en una conexión inactiva:', error);
});

let initialization;

async function initialize() {
  if (!initialization) {
    initialization = (async () => {
      if (!config.databaseUrl) throw new Error('Falta DATABASE_URL para conectar con Neon Postgres.');
      await pool.query(`
        CREATE TABLE IF NOT EXISTS users (
          id SERIAL PRIMARY KEY,
          email TEXT NOT NULL,
          password_hash TEXT NOT NULL,
          role TEXT NOT NULL DEFAULT 'admin' CHECK (role IN ('admin', 'editor')),
          token_version INTEGER NOT NULL DEFAULT 0,
          last_login_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_unique ON users (LOWER(email));

        CREATE TABLE IF NOT EXISTS password_reset_tokens (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          token_hash TEXT NOT NULL UNIQUE,
          expires_at TIMESTAMPTZ NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user ON password_reset_tokens(user_id);

        CREATE TABLE IF NOT EXISTS categories (
          id SERIAL PRIMARY KEY,
          name TEXT NOT NULL,
          slug TEXT NOT NULL UNIQUE,
          position INTEGER NOT NULL DEFAULT 0,
          created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE UNIQUE INDEX IF NOT EXISTS categories_name_lower_unique ON categories (LOWER(name));

        CREATE TABLE IF NOT EXISTS products (
          id SERIAL PRIMARY KEY,
          name TEXT NOT NULL,
          slug TEXT NOT NULL UNIQUE,
          category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
          description TEXT NOT NULL DEFAULT '',
          specs JSONB NOT NULL DEFAULT '[]'::jsonb,
          status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
          created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_products_category_status ON products(category_id, status);

        CREATE TABLE IF NOT EXISTS product_images (
          id SERIAL PRIMARY KEY,
          product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
          filename TEXT NOT NULL,
          position INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_images_product ON product_images(product_id, position);
      `);
    })().catch(error => {
      initialization = null;
      throw error;
    });
  }
  return initialization;
}

async function query(text, values = []) {
  await initialize();
  return pool.query(text, values);
}

async function transaction(callback) {
  await initialize();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

module.exports = { initialize, query, transaction, close: () => pool.end() };
