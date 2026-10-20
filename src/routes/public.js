'use strict';
const express = require('express');
const db = require('../db');
const config = require('../config');

const router = express.Router();

/* API PÚBLICA (solo lectura). Devuelve únicamente productos ACTIVOS.
   Ningún endpoint expone precios: el esquema ni siquiera tiene esa columna. */

const imagesOf = db.prepare('SELECT id, filename FROM product_images WHERE product_id = ? ORDER BY position, id');

function serialize(p) {
  return {
    id: p.id,
    slug: p.slug,
    name: p.name,
    description: p.description,
    specs: JSON.parse(p.specs),
    category: { name: p.category_name, slug: p.category_slug },
    images: imagesOf.all(p.id).map(i => ({ id: i.id, url: `/uploads/${i.filename}` }))
  };
}

const BASE = `
  SELECT p.*, c.name AS category_name, c.slug AS category_slug
  FROM products p JOIN categories c ON c.id = p.category_id
  WHERE p.status = 'active'`;

router.get('/config', (req, res) => {
  const b = config.business;
  res.json({
    businessName: b.name,
    whatsappNumber: b.whatsappNumber,
    whatsappMessage: b.whatsappMessage,
    instagram: b.instagram,
    mapQuery: b.mapQuery
  });
});

// Tipos de producto que tienen al menos un producto activo, con su cantidad.
router.get('/categories', (req, res) => {
  const rows = db
    .prepare(
      `SELECT c.id, c.name, c.slug, COUNT(p.id) AS count
       FROM categories c
       JOIN products p ON p.category_id = c.id AND p.status = 'active'
       GROUP BY c.id
       ORDER BY c.position, c.name`
    )
    .all();
  res.json(rows);
});

// Filtro por tipo en el servidor:  GET /api/products?category=tractores
router.get('/products', (req, res) => {
  const slug = typeof req.query.category === 'string' ? req.query.category : '';
  const rows = slug
    ? db.prepare(`${BASE} AND c.slug = ? ORDER BY p.created_at DESC, p.id DESC`).all(slug)
    : db.prepare(`${BASE} ORDER BY p.created_at DESC, p.id DESC`).all();
  res.json(rows.map(serialize));
});

router.get('/products/:slug', (req, res) => {
  const row = db.prepare(`${BASE} AND p.slug = ?`).get(req.params.slug);
  if (!row) return res.status(404).json({ error: 'Producto no encontrado.' });
  res.json(serialize(row));
});

module.exports = router;
