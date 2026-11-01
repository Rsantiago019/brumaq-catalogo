'use strict';
const express = require('express');
const rateLimit = require('express-rate-limit');
const { sendInquiry } = require('../email');
const db = require('../db');
const config = require('../config');

const router = express.Router();

const BASE = `
  SELECT p.*, c.name AS category_name, c.slug AS category_slug
  FROM products p JOIN categories c ON c.id = p.category_id
  WHERE p.status = 'active'`;

async function serialize(product) {
  const { rows: images } = await db.query(
    'SELECT id, filename FROM product_images WHERE product_id = $1 ORDER BY position, id',
    [product.id]
  );
  return {
    id: product.id,
    slug: product.slug,
    name: product.name,
    description: product.description,
    specs: product.specs,
    price: product.price,
    category: { name: product.category_name, slug: product.category_slug },
    images: images.map(image => ({ id: image.id, url: image.filename }))
  };
}

router.get('/config', (req, res) => {
  const business = config.business;
  res.json({
    businessName: business.name,
    whatsappNumber: business.whatsappNumber,
    whatsappMessage: business.whatsappMessage,
    instagram: business.instagram,
    mapQuery: business.mapQuery,
    inquiryEnabled: Boolean(config.email.enabled && config.email.contactTo)
  });
});

router.get('/categories', async (req, res) => {
  const { rows } = await db.query(
    `SELECT c.id, c.name, c.slug, COUNT(p.id)::integer AS count
     FROM categories c
     JOIN products p ON p.category_id = c.id AND p.status = 'active'
     GROUP BY c.id
     ORDER BY c.position, c.name`
  );
  res.json(rows);
});

router.get('/products', async (req, res) => {
  const slug = typeof req.query.category === 'string' ? req.query.category : '';
  const result = slug
    ? await db.query(`${BASE} AND c.slug = $1 ORDER BY p.created_at DESC, p.id DESC`, [slug])
    : await db.query(`${BASE} ORDER BY p.created_at DESC, p.id DESC`);
  res.json(await Promise.all(result.rows.map(serialize)));
});

router.get('/products/:slug', async (req, res) => {
  const { rows } = await db.query(`${BASE} AND p.slug = $1`, [req.params.slug]);
  const product = rows[0];
  if (!product) return res.status(404).json({ error: 'Producto no encontrado.' });
  res.json(await serialize(product));
});

const inquiryLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Demasiadas consultas. Espere unos minutos o escríbanos por WhatsApp.' }
});

router.post('/inquiries', inquiryLimiter, async (req, res) => {
  const b = req.body || {};
  const clean = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '');
  if (clean(b.website, 100)) return res.json({ ok: true }); // campo trampa para bots
  const name = clean(b.name, 80);
  const contact = clean(b.contact, 120);
  const product = clean(b.product, 120);
  const message = clean(b.message, 1500);
  if (name.length < 2) return res.status(400).json({ error: 'Ingrese su nombre.' });
  const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact);
  if (!isEmail && contact.replace(/\D/g, '').length < 6) {
    return res.status(400).json({ error: 'Ingrese un email o teléfono válido.' });
  }
  if (message.length < 5) return res.status(400).json({ error: 'Escriba su consulta.' });
  if (!config.email.enabled || !config.email.contactTo) {
    return res.status(503).json({ error: 'El formulario no está disponible por ahora. Escríbanos por WhatsApp.' });
  }
  try {
    await sendInquiry({ name, contact, replyTo: isEmail ? contact : '', product, message });
  } catch (error) {
    console.error('[INQUIRY]', error.message);
    return res.status(502).json({ error: 'No pudimos enviar su consulta. Escríbanos por WhatsApp.' });
  }
  res.json({ ok: true });
});

module.exports = router;
