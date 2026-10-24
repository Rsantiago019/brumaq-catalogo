'use strict';
const express = require('express');
const db = require('../db');
const config = require('../config');
const { hashPassword, passwordIssues, verifyPassword } = require('../security');
const { slugify, uniqueSlug, parseSpecs } = require('../utils');
const { imageUpload, removeFiles, isManagedImageUrl } = require('../upload');

const router = express.Router();
const MAX_IMAGES = config.limits.maxImagesPerProduct;

router.post('/users', async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Solo un administrador puede crear cuentas.' });

  const email = String(req.body?.email ?? '').trim().toLowerCase();
  const password = String(req.body?.password ?? '');
  if (email.length > 254 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return res.status(400).json({ error: 'Ingrese un email válido.' });
  }
  const issues = passwordIssues(password);
  if (issues.length) return res.status(400).json({ error: issues.join(' ') });

  const passwordHash = await hashPassword(password);
  try {
    await db.query(
      `INSERT INTO users (email, password_hash, role)
       VALUES ($1, $2, 'admin')`,
      [email, passwordHash]
    );
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'Ya existe una cuenta con ese email.' });
    throw error;
  }
  res.status(201).json({ user: { email, role: 'admin' } });
});

router.put('/password', async (req, res) => {
  const currentPassword = String(req.body?.currentPassword ?? '');
  const newPassword = String(req.body?.newPassword ?? '');
  const result = await db.query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
  const currentUser = result.rows[0];
  if (!currentUser || !(await verifyPassword(currentPassword, currentUser.password_hash))) {
    return res.status(400).json({ error: 'La contraseña actual es incorrecta.' });
  }

  const issues = passwordIssues(newPassword);
  if (issues.length) return res.status(400).json({ error: issues.join(' ') });
  const passwordHash = await hashPassword(newPassword);
  await db.query(
    'UPDATE users SET password_hash = $1, token_version = token_version + 1 WHERE id = $2',
    [passwordHash, req.user.id]
  );
  res.json({ ok: true });
});

router.post('/uploads', imageUpload, (req, res) => {
  res.status(201).json({ image: req.uploadedImage });
});

router.delete('/uploads', async (req, res) => {
  const urls = req.body?.urls;
  if (!Array.isArray(urls) || urls.some(url => !isManagedImageUrl(url))) {
    return res.status(400).json({ error: 'Lista de imágenes inválida.' });
  }
  await removeFiles(urls);
  res.json({ ok: true });
});

const SELECT = `
  SELECT p.*, c.name AS category_name
  FROM products p JOIN categories c ON c.id = p.category_id`;

async function imagesOf(productId) {
  const { rows } = await db.query(
    'SELECT id, filename FROM product_images WHERE product_id = $1 ORDER BY position, id',
    [productId]
  );
  return rows;
}

async function serialize(product) {
  const images = await imagesOf(product.id);
  return {
    id: product.id,
    slug: product.slug,
    name: product.name,
    description: product.description,
    specs: product.specs,
    status: product.status,
    category_id: product.category_id,
    category: product.category_name,
    created_at: product.created_at,
    updated_at: product.updated_at,
    images: images.map(image => ({ id: image.id, url: image.filename }))
  };
}

async function getProduct(id) {
  const result = await db.query(`${SELECT} WHERE p.id = $1`, [id]);
  return result.rows[0];
}

function validateImageUrls(value) {
  if (value === undefined) return { urls: [] };
  if (!Array.isArray(value) || value.length > MAX_IMAGES || value.some(url => !isManagedImageUrl(url))) {
    return { error: `Las imágenes deben ser archivos cargados válidos (máximo ${MAX_IMAGES}).` };
  }
  return { urls: value };
}

async function validateProduct(body, { partial }) {
  const b = body || {};
  const data = {};
  const has = key => b[key] !== undefined;

  if (!partial || has('name')) {
    const name = String(b.name ?? '').trim();
    if (name.length < 2 || name.length > 120) return { error: 'El nombre debe tener entre 2 y 120 caracteres.' };
    data.name = name;
  }
  if (!partial || has('category_id')) {
    const id = Number.parseInt(b.category_id, 10);
    const category = Number.isInteger(id)
      ? await db.query('SELECT 1 FROM categories WHERE id = $1', [id])
      : { rowCount: 0 };
    if (!category.rowCount) return { error: 'Seleccione un tipo de producto válido.' };
    data.category_id = id;
  }
  if (!partial || has('status')) {
    const status = String(b.status ?? 'active');
    if (!['active', 'inactive'].includes(status)) return { error: 'Estado inválido.' };
    data.status = status;
  }
  if (!partial || has('description')) {
    const description = String(b.description ?? '').trim();
    if (description.length > 5000) return { error: 'La descripción es demasiado larga (máx. 5000).' };
    data.description = description;
  }
  if (!partial || has('specs')) {
    const parsed = parseSpecs(b.specs ?? []);
    if (parsed.error) return { error: parsed.error };
    data.specs = parsed.specs;
  }
  const imageResult = validateImageUrls(b.images);
  if (imageResult.error) return imageResult;
  data.images = imageResult.urls;
  return { data };
}

router.get('/products', async (req, res) => {
  const result = await db.query(`${SELECT} ORDER BY p.updated_at DESC, p.id DESC`);
  res.json(await Promise.all(result.rows.map(serialize)));
});

router.get('/products/:id', async (req, res) => {
  const product = await getProduct(req.params.id);
  if (!product) return res.status(404).json({ error: 'Producto no encontrado.' });
  res.json(await serialize(product));
});

router.post('/products', async (req, res) => {
  const validated = await validateProduct(req.body, { partial: false });
  if (validated.error) return res.status(400).json({ error: validated.error });
  const data = validated.data;
  const id = await db.transaction(async client => {
    const slug = await uniqueSlug('products', slugify(data.name));
    const result = await client.query(
      `INSERT INTO products (name, slug, category_id, description, specs, status)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6) RETURNING id`,
      [data.name, slug, data.category_id, data.description, JSON.stringify(data.specs), data.status]
    );
    const productId = result.rows[0].id;
    for (const [position, url] of data.images.entries()) {
      await client.query(
        'INSERT INTO product_images (product_id, filename, position) VALUES ($1, $2, $3)',
        [productId, url, position]
      );
    }
    return productId;
  });
  res.status(201).json(await serialize(await getProduct(id)));
});

router.put('/products/:id', async (req, res) => {
  const current = await getProduct(req.params.id);
  if (!current) return res.status(404).json({ error: 'Producto no encontrado.' });

  const validated = await validateProduct(req.body, { partial: true });
  if (validated.error) return res.status(400).json({ error: validated.error });
  const data = validated.data;
  let removeIds = req.body?.remove_images ?? [];
  if (typeof removeIds === 'string') {
    try {
      removeIds = JSON.parse(removeIds);
    } catch {
      return res.status(400).json({ error: 'Lista de imágenes a quitar inválida.' });
    }
  }
  if (!Array.isArray(removeIds) || removeIds.some(id => !Number.isInteger(Number(id)))) {
    return res.status(400).json({ error: 'Lista de imágenes a quitar inválida.' });
  }
  const existing = await imagesOf(current.id);
  const toRemove = existing.filter(image => removeIds.map(Number).includes(image.id));
  const keptCount = existing.length - toRemove.length;
  if (keptCount + data.images.length > MAX_IMAGES) {
    return res.status(400).json({ error: `Máximo ${MAX_IMAGES} imágenes por producto.` });
  }

  await db.transaction(async client => {
    const { images, ...fields } = data;
    const keys = Object.keys(fields);
    if (keys.length) {
      const values = Object.values(fields);
      const sets = keys.map((key, index) =>
        `${key} = $${index + 1}${key === 'specs' ? '::jsonb' : ''}`
      );
      if (fields.specs !== undefined) values[keys.indexOf('specs')] = JSON.stringify(fields.specs);
      values.push(current.id);
      await client.query(
        `UPDATE products SET ${sets.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = $${values.length}`,
        values
      );
    } else if (images.length || toRemove.length) {
      await client.query('UPDATE products SET updated_at = CURRENT_TIMESTAMP WHERE id = $1', [current.id]);
    }
    for (const image of toRemove) {
      await client.query('DELETE FROM product_images WHERE id = $1 AND product_id = $2', [image.id, current.id]);
    }
    const lastResult = await client.query(
      'SELECT COALESCE(MAX(position), -1) AS position FROM product_images WHERE product_id = $1',
      [current.id]
    );
    let position = Number(lastResult.rows[0].position) + 1;
    for (const url of images) {
      await client.query(
        'INSERT INTO product_images (product_id, filename, position) VALUES ($1, $2, $3)',
        [current.id, url, position++]
      );
    }
  });
  await removeFiles(toRemove.map(image => image.filename));
  res.json(await serialize(await getProduct(current.id)));
});

router.delete('/products/:id', async (req, res) => {
  const current = await getProduct(req.params.id);
  if (!current) return res.status(404).json({ error: 'Producto no encontrado.' });
  const images = await imagesOf(current.id);
  await db.query('DELETE FROM products WHERE id = $1', [current.id]);
  await removeFiles(images.map(image => image.filename));
  res.json({ ok: true });
});

async function catRows() {
  const { rows } = await db.query(
    `SELECT c.id, c.name, c.slug, c.position, COUNT(p.id)::integer AS products
     FROM categories c LEFT JOIN products p ON p.category_id = c.id
     GROUP BY c.id ORDER BY c.position, c.name`
  );
  return rows;
}

function cleanCategoryName(value) {
  const name = String(value ?? '').trim();
  return name.length >= 2 && name.length <= 60 ? name : null;
}

router.get('/categories', async (req, res) => res.json(await catRows()));

router.post('/categories', async (req, res) => {
  const name = cleanCategoryName(req.body?.name);
  if (!name) return res.status(400).json({ error: 'El nombre debe tener entre 2 y 60 caracteres.' });
  try {
    const pos = await db.query('SELECT COALESCE(MAX(position), 0) + 1 AS position FROM categories');
    const slug = await uniqueSlug('categories', slugify(name));
    await db.query('INSERT INTO categories (name, slug, position) VALUES ($1, $2, $3)', [name, slug, pos.rows[0].position]);
    res.status(201).json(await catRows());
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'Ya existe un tipo con ese nombre.' });
    throw error;
  }
});

router.put('/categories/:id', async (req, res) => {
  const name = cleanCategoryName(req.body?.name);
  if (!name) return res.status(400).json({ error: 'El nombre debe tener entre 2 y 60 caracteres.' });
  try {
    const slug = await uniqueSlug('categories', slugify(name), Number(req.params.id));
    const result = await db.query(
      'UPDATE categories SET name = $1, slug = $2 WHERE id = $3',
      [name, slug, req.params.id]
    );
    if (!result.rowCount) return res.status(404).json({ error: 'Tipo no encontrado.' });
    res.json(await catRows());
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'Ya existe un tipo con ese nombre.' });
    throw error;
  }
});

router.delete('/categories/:id', async (req, res) => {
  const result = await db.query('SELECT COUNT(*)::integer AS count FROM products WHERE category_id = $1', [req.params.id]);
  const used = result.rows[0].count;
  if (used) {
    return res.status(409).json({ error: `No se puede borrar: tiene ${used} producto(s). Muévalos antes a otro tipo.` });
  }
  await db.query('DELETE FROM categories WHERE id = $1', [req.params.id]);
  res.json(await catRows());
});

module.exports = router;
