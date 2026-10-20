'use strict';
const express = require('express');
const db = require('../db');
const config = require('../config');
const { hashPassword, passwordIssues, verifyPassword } = require('../security');
const { slugify, uniqueSlug, parseSpecs } = require('../utils');
const { imageUpload, removeFiles } = require('../upload');

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
  const result = db.prepare(
    `INSERT INTO users (email, password_hash, role)
     VALUES (?, ?, 'admin')
     ON CONFLICT(email) DO NOTHING`
  ).run(email, passwordHash);
  if (!result.changes) return res.status(409).json({ error: 'Ya existe una cuenta con ese email.' });
  res.status(201).json({ user: { email, role: 'admin' } });
});

router.put('/password', async (req, res) => {
  const currentPassword = String(req.body?.currentPassword ?? '');
  const newPassword = String(req.body?.newPassword ?? '');
  const currentUser = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
  if (!currentUser || !(await verifyPassword(currentPassword, currentUser.password_hash))) {
    return res.status(400).json({ error: 'La contraseña actual es incorrecta.' });
  }

  const issues = passwordIssues(newPassword);
  if (issues.length) return res.status(400).json({ error: issues.join(' ') });
  const passwordHash = await hashPassword(newPassword);
  db.prepare('UPDATE users SET password_hash = ?, token_version = token_version + 1 WHERE id = ?')
    .run(passwordHash, req.user.id);
  res.json({ ok: true });
});

/* =================================================================
   PRODUCTOS  (todas estas rutas están detrás de authRequired + csrfGuard)
   ================================================================= */

const imagesOf = db.prepare('SELECT id, filename FROM product_images WHERE product_id = ? ORDER BY position, id');

function serialize(p) {
  return {
    id: p.id,
    slug: p.slug,
    name: p.name,
    description: p.description,
    specs: JSON.parse(p.specs),
    status: p.status,
    category_id: p.category_id,
    category: p.category_name,
    created_at: p.created_at,
    updated_at: p.updated_at,
    images: imagesOf.all(p.id).map(i => ({ id: i.id, url: `/uploads/${i.filename}` }))
  };
}

const SELECT = `
  SELECT p.*, c.name AS category_name
  FROM products p JOIN categories c ON c.id = p.category_id`;

const getProduct = id => db.prepare(`${SELECT} WHERE p.id = ?`).get(id);

/** Valida el cuerpo. En modo "partial" (PUT) solo se validan los campos enviados. */
function validateProduct(body, { partial }) {
  const b = body || {};
  const data = {};
  const has = k => b[k] !== undefined;

  if (!partial || has('name')) {
    const name = String(b.name ?? '').trim();
    if (name.length < 2 || name.length > 120) return { error: 'El nombre debe tener entre 2 y 120 caracteres.' };
    data.name = name;
  }
  if (!partial || has('category_id')) {
    const id = Number.parseInt(b.category_id, 10);
    if (!Number.isInteger(id) || !db.prepare('SELECT 1 FROM categories WHERE id = ?').get(id)) {
      return { error: 'Seleccione un tipo de producto válido.' };
    }
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
    const r = parseSpecs(b.specs ?? '[]');
    if (r.error) return { error: r.error };
    data.specs = JSON.stringify(r.specs);
  }
  return { data };
}

// LEER (listado completo, incluye inactivos)
router.get('/products', (req, res) => {
  res.json(db.prepare(`${SELECT} ORDER BY p.updated_at DESC, p.id DESC`).all().map(serialize));
});

router.get('/products/:id', (req, res) => {
  const row = getProduct(req.params.id);
  if (!row) return res.status(404).json({ error: 'Producto no encontrado.' });
  res.json(serialize(row));
});

// CREAR  (multipart/form-data con campo "images")
router.post('/products', imageUpload, (req, res) => {
  const files = req.files || [];
  const v = validateProduct(req.body, { partial: false });
  if (v.error) {
    removeFiles(files.map(f => f.filename));
    return res.status(400).json({ error: v.error });
  }
  const d = v.data;
  try {
    const id = db.transaction(() => {
      const slug = uniqueSlug('products', slugify(d.name));
      const info = db
        .prepare(
          `INSERT INTO products (name, slug, category_id, description, specs, status)
           VALUES (@name, @slug, @category_id, @description, @specs, @status)`
        )
        .run({ ...d, slug });
      const insImg = db.prepare('INSERT INTO product_images (product_id, filename, position) VALUES (?, ?, ?)');
      files.forEach((f, i) => insImg.run(info.lastInsertRowid, f.filename, i));
      return info.lastInsertRowid;
    })();
    res.status(201).json(serialize(getProduct(id)));
  } catch (err) {
    removeFiles(files.map(f => f.filename));
    throw err;
  }
});

// ACTUALIZAR  (acepta multipart o JSON; solo cambia los campos enviados)
//   remove_images: JSON con los IDs de imágenes a quitar, ej. "[3,5]"
router.put('/products/:id', imageUpload, (req, res) => {
  const files = req.files || [];
  const fail = (code, error) => {
    removeFiles(files.map(f => f.filename));
    return res.status(code).json({ error });
  };

  const current = getProduct(req.params.id);
  if (!current) return fail(404, 'Producto no encontrado.');

  const v = validateProduct(req.body, { partial: true });
  if (v.error) return fail(400, v.error);

  let removeIds = [];
  if (req.body?.remove_images) {
    try {
      removeIds = JSON.parse(req.body.remove_images).map(Number);
    } catch {
      return fail(400, 'Lista de imágenes a quitar inválida.');
    }
  }
  const existing = imagesOf.all(current.id);
  const toRemove = existing.filter(i => removeIds.includes(i.id));
  if (existing.length - toRemove.length + files.length > MAX_IMAGES) {
    return fail(400, `Máximo ${MAX_IMAGES} imágenes por producto.`);
  }

  try {
    db.transaction(() => {
      const d = v.data;
      const keys = Object.keys(d);
      if (keys.length) {
        const sets = keys.map(k => `${k} = @${k}`).join(', '); // las claves salen de validateProduct, no del usuario
        db.prepare(`UPDATE products SET ${sets}, updated_at = CURRENT_TIMESTAMP WHERE id = @id`).run({ ...d, id: current.id });
      } else if (files.length || toRemove.length) {
        db.prepare('UPDATE products SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(current.id);
      }
      const del = db.prepare('DELETE FROM product_images WHERE id = ? AND product_id = ?');
      toRemove.forEach(i => del.run(i.id, current.id));
      const last = db.prepare('SELECT COALESCE(MAX(position), -1) AS m FROM product_images WHERE product_id = ?').get(current.id).m;
      const ins = db.prepare('INSERT INTO product_images (product_id, filename, position) VALUES (?, ?, ?)');
      files.forEach((f, i) => ins.run(current.id, f.filename, last + 1 + i));
    })();
  } catch (err) {
    removeFiles(files.map(f => f.filename));
    throw err;
  }
  removeFiles(toRemove.map(i => i.filename)); // se borran del disco recién tras confirmar la transacción
  res.json(serialize(getProduct(current.id)));
});

// BORRAR
router.delete('/products/:id', (req, res) => {
  const current = getProduct(req.params.id);
  if (!current) return res.status(404).json({ error: 'Producto no encontrado.' });
  const files = imagesOf.all(current.id).map(i => i.filename);
  db.prepare('DELETE FROM products WHERE id = ?').run(current.id); // product_images se borra en cascada
  removeFiles(files);
  res.json({ ok: true });
});

/* =================================================================
   CATEGORÍAS / TIPOS DE PRODUCTO
   ================================================================= */
const catRows = () =>
  db
    .prepare(
      `SELECT c.id, c.name, c.slug, c.position, COUNT(p.id) AS products
       FROM categories c LEFT JOIN products p ON p.category_id = c.id
       GROUP BY c.id ORDER BY c.position, c.name`
    )
    .all();

function cleanCategoryName(v) {
  const name = String(v ?? '').trim();
  return name.length >= 2 && name.length <= 60 ? name : null;
}
const isUnique = err => String(err.code).startsWith('SQLITE_CONSTRAINT');

router.get('/categories', (req, res) => res.json(catRows()));

router.post('/categories', (req, res) => {
  const name = cleanCategoryName(req.body?.name);
  if (!name) return res.status(400).json({ error: 'El nombre debe tener entre 2 y 60 caracteres.' });
  try {
    const pos = db.prepare('SELECT COALESCE(MAX(position), 0) + 1 AS p FROM categories').get().p;
    db.prepare('INSERT INTO categories (name, slug, position) VALUES (?, ?, ?)').run(name, uniqueSlug('categories', slugify(name)), pos);
    res.status(201).json(catRows());
  } catch (err) {
    if (isUnique(err)) return res.status(409).json({ error: 'Ya existe un tipo con ese nombre.' });
    throw err;
  }
});

router.put('/categories/:id', (req, res) => {
  const name = cleanCategoryName(req.body?.name);
  if (!name) return res.status(400).json({ error: 'El nombre debe tener entre 2 y 60 caracteres.' });
  try {
    const info = db
      .prepare('UPDATE categories SET name = ?, slug = ? WHERE id = ?')
      .run(name, uniqueSlug('categories', slugify(name), Number(req.params.id)), req.params.id);
    if (!info.changes) return res.status(404).json({ error: 'Tipo no encontrado.' });
    res.json(catRows());
  } catch (err) {
    if (isUnique(err)) return res.status(409).json({ error: 'Ya existe un tipo con ese nombre.' });
    throw err;
  }
});

router.delete('/categories/:id', (req, res) => {
  const used = db.prepare('SELECT COUNT(*) AS n FROM products WHERE category_id = ?').get(req.params.id).n;
  if (used) return res.status(409).json({ error: `No se puede borrar: tiene ${used} producto(s). Muévalos antes a otro tipo.` });
  db.prepare('DELETE FROM categories WHERE id = ?').run(req.params.id);
  res.json(catRows());
});

module.exports = router;
