'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const { put, del } = require('@vercel/blob');
const config = require('../src/config');
const db = require('../src/db');

const MIME_BY_EXTENSION = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };
const uploadedUrls = [];

function imageType(filename) {
  return MIME_BY_EXTENSION[path.extname(filename).toLowerCase()];
}

async function main() {
  if (!config.blobToken) throw new Error('Falta BLOB_READ_WRITE_TOKEN.');
  if (!fs.existsSync(config.sourceDbPath)) throw new Error(`No se encuentra la base de origen: ${config.sourceDbPath}`);
  await db.initialize();

  const sqlite = new Database(config.sourceDbPath, { readonly: true });
  try {
    const sourceUsers = sqlite.prepare('SELECT * FROM users ORDER BY id').all();
    const sourceTokens = sqlite.prepare('SELECT * FROM password_reset_tokens ORDER BY id').all();
    const sourceCategories = sqlite.prepare('SELECT * FROM categories ORDER BY id').all();
    const sourceProducts = sqlite.prepare('SELECT * FROM products ORDER BY id').all();
    const sourceImages = sqlite.prepare('SELECT * FROM product_images ORDER BY id').all();
    const targetCounts = await db.query(`
      SELECT
        (SELECT COUNT(*) FROM users)::integer AS users,
        (SELECT COUNT(*) FROM categories)::integer AS categories,
        (SELECT COUNT(*) FROM products)::integer AS products
    `);
    if (Object.values(targetCounts.rows[0]).some(count => count !== 0)) {
      throw new Error('La base de destino no está vacía; se cancela para evitar sobrescribir datos.');
    }

    const migratedImages = [];
    for (const image of sourceImages) {
      const sourcePath = path.join(config.sourceUploadDir, path.basename(image.filename));
      if (!fs.existsSync(sourcePath)) throw new Error(`No se encuentra la imagen de origen "${path.basename(image.filename)}".`);
      const extension = path.extname(image.filename).toLowerCase();
      if (extension === '.svg' && path.basename(image.filename).startsWith('demo-')) {
        migratedImages.push({ ...image, url: '/img/placeholder.svg' });
        continue;
      }
      const contentType = imageType(image.filename);
      if (!contentType) throw new Error(`Formato de imagen no compatible en "${path.basename(image.filename)}".`);
      const blob = await put(
        `product-images/migrated-${image.id}-${crypto.randomBytes(8).toString('hex')}${extension}`,
        fs.readFileSync(sourcePath),
        { access: 'public', contentType, token: config.blobToken }
      );
      uploadedUrls.push(blob.url);
      migratedImages.push({ ...image, url: blob.url });
    }

    await db.transaction(async client => {
      for (const user of sourceUsers) {
        await client.query(
          `INSERT INTO users (id, email, password_hash, role, token_version, last_login_at, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [user.id, user.email, user.password_hash, user.role, user.token_version, user.last_login_at, user.created_at]
        );
      }
      for (const token of sourceTokens) {
        await client.query(
          `INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at, created_at)
           VALUES ($1, $2, $3, $4, $5)`,
          [token.id, token.user_id, token.token_hash, token.expires_at, token.created_at]
        );
      }
      for (const category of sourceCategories) {
        await client.query(
          'INSERT INTO categories (id, name, slug, position, created_at) VALUES ($1, $2, $3, $4, $5)',
          [category.id, category.name, category.slug, category.position, category.created_at]
        );
      }
      for (const product of sourceProducts) {
        await client.query(
          `INSERT INTO products (id, name, slug, category_id, description, specs, status, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9)`,
          [
            product.id, product.name, product.slug, product.category_id, product.description,
            product.specs, product.status, product.created_at, product.updated_at
          ]
        );
      }
      for (const image of migratedImages) {
        await client.query(
          'INSERT INTO product_images (id, product_id, filename, position) VALUES ($1, $2, $3, $4)',
          [image.id, image.product_id, image.url, image.position]
        );
      }
      for (const table of ['users', 'password_reset_tokens', 'categories', 'products', 'product_images']) {
        await client.query(
          `SELECT setval(pg_get_serial_sequence('${table}', 'id'), COALESCE((SELECT MAX(id) FROM ${table}), 1), EXISTS (SELECT 1 FROM ${table}))`
        );
      }
    });
    console.log(
      `Migración terminada: ${sourceUsers.length} cuentas, ${sourceCategories.length} categorías, ` +
      `${sourceProducts.length} productos y ${sourceImages.length} imágenes.`
    );
  } catch (error) {
    if (uploadedUrls.length) {
      try {
        await del(uploadedUrls, { token: config.blobToken });
      } catch (cleanupError) {
        console.error('[MIGRACIÓN] No se pudieron eliminar los archivos temporales de Blob:', cleanupError);
      }
    }
    throw error;
  } finally {
    sqlite.close();
  }
}

main()
  .catch(error => {
    console.error('[MIGRACIÓN] No se completó:', error);
    process.exitCode = 1;
  })
  .finally(() => db.close());
