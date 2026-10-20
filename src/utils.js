'use strict';
const db = require('./db');

function slugify(text) {
  return (
    String(text)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'producto'
  );
}

// "table" es siempre una constante interna ('products' o 'categories'), nunca dato del usuario.
function uniqueSlug(table, base, ignoreId = null) {
  const q = db.prepare(`SELECT id FROM ${table} WHERE slug = ? AND id != ?`);
  let slug = base;
  let i = 2;
  while (q.get(slug, ignoreId ?? -1)) slug = `${base}-${i++}`;
  return slug;
}

/** Valida y normaliza las especificaciones técnicas: [{label, value}] */
function parseSpecs(input) {
  let arr = input;
  if (typeof input === 'string') {
    try {
      arr = JSON.parse(input);
    } catch {
      return { error: 'Las características tienen un formato inválido.' };
    }
  }
  if (!Array.isArray(arr)) return { error: 'Las características deben ser una lista.' };
  if (arr.length > 30) return { error: 'Máximo 30 características por producto.' };
  const specs = [];
  for (const s of arr) {
    const label = String(s?.label ?? '').trim();
    const value = String(s?.value ?? '').trim();
    if (!label && !value) continue;
    if (!label || !value) return { error: 'Cada característica necesita nombre y valor.' };
    if (label.length > 60 || value.length > 200) return { error: 'Una característica es demasiado larga.' };
    specs.push({ label, value });
  }
  return { specs };
}

module.exports = { slugify, uniqueSlug, parseSpecs };
