'use strict';
const db = require('../src/db');
const { slugify } = require('../src/utils');
const { removeFiles } = require('../src/upload');

const reset = process.argv.includes('--reset');
const CATEGORIES = ['Tractores', 'Trilladoras', 'Cosechadoras', 'Arados', 'Rastras', 'Sembradoras', 'Implementos y repuestos'];
const NOTE = ' Ficha de ejemplo: reemplace estos datos por los del producto real desde el panel.';
const PRODUCTS = [
  { name: 'Tractor 4x4 modelo ejemplo', cat: 'Tractores', status: 'active', description: 'Tractor versátil para labranza, siembra y transporte.' + NOTE, specs: [['Potencia', '110 HP'], ['Tracción', '4x4'], ['Transmisión', 'Mecánica 12x12'], ['Uso', 'Labranza y siembra']] },
  { name: 'Trilladora estacionaria modelo ejemplo', cat: 'Trilladoras', status: 'active', description: 'Trilladora para cereales y forrajes con alimentación lateral.' + NOTE, specs: [['Tipo', 'Estacionaria'], ['Accionamiento', 'Toma de fuerza'], ['Cultivos', 'Trigo, avena, cebada'], ['Capacidad', 'Según cultivo']] },
  { name: 'Cosechadora autopropulsada modelo ejemplo', cat: 'Cosechadoras', status: 'active', description: 'Cosechadora de granos con plataforma de corte frontal.' + NOTE, specs: [['Tipo', 'Autopropulsada'], ['Plataforma', '4,5 m'], ['Tolva', '6.000 L'], ['Cultivos', 'Cereales y oleaginosas']] },
  { name: 'Arado de reja modelo ejemplo', cat: 'Arados', status: 'active', description: 'Arado reversible para labranza primaria del suelo.' + NOTE, specs: [['Cuerpos', '3'], ['Enganche', '3 puntos'], ['Tractor sugerido', '70–100 HP'], ['Uso', 'Labranza primaria']] },
  { name: 'Rastra de discos modelo ejemplo', cat: 'Rastras', status: 'active', description: 'Rastra de doble acción para afinar el suelo antes de la siembra.' + NOTE, specs: [['Discos', '24'], ['Ancho de trabajo', '2,8 m'], ['Enganche', 'De arrastre'], ['Tractor sugerido', '80–120 HP']] },
  { name: 'Sembradora de granos modelo ejemplo', cat: 'Sembradoras', status: 'active', description: 'Sembradora para pasturas, cereales y forrajes.' + NOTE, specs: [['Líneas', '13'], ['Tolva', '600 L'], ['Distribución', 'Mecánica'], ['Uso', 'Siembra directa y convencional']] },
  { name: 'Kit de repuestos de labranza modelo ejemplo', cat: 'Implementos y repuestos', status: 'active', description: 'Rejas, discos y piezas de desgaste para implementos de labranza.' + NOTE, specs: [['Contenido', 'Rejas, discos y bulonería'], ['Compatibilidad', 'Consultar modelo']] },
  { name: 'Tractor borrador (inactivo)', cat: 'Tractores', status: 'inactive', description: 'Ejemplo de producto inactivo: no se muestra en el catálogo público.', specs: [['Estado', 'En preparación']] }
];

(async () => {
  await db.initialize();
  const existing = await db.query('SELECT COUNT(*)::integer AS count FROM products');
  if (existing.rows[0].count && !reset) {
    console.log('Ya hay productos cargados. Use --reset para reemplazarlos por los de ejemplo.');
    return;
  }

  const oldImages = reset
    ? (await db.query('SELECT filename FROM product_images')).rows.map(image => image.filename)
    : [];
  await db.transaction(async client => {
    if (reset) {
      await client.query('DELETE FROM products');
      await client.query('DELETE FROM categories');
    }
    const categoryIds = new Map();
    for (const [index, name] of CATEGORIES.entries()) {
      const inserted = await client.query(
        'INSERT INTO categories (name, slug, position) VALUES ($1, $2, $3) RETURNING id',
        [name, slugify(name), index + 1]
      );
      categoryIds.set(name, inserted.rows[0].id);
    }
    for (const product of PRODUCTS) {
      const inserted = await client.query(
        `INSERT INTO products (name, slug, category_id, description, specs, status)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6) RETURNING id`,
        [
          product.name,
          slugify(product.name),
          categoryIds.get(product.cat),
          product.description,
          JSON.stringify(product.specs.map(([label, value]) => ({ label, value }))),
          product.status
        ]
      );
      await client.query(
        'INSERT INTO product_images (product_id, filename, position) VALUES ($1, $2, 0)',
        [inserted.rows[0].id, '/img/placeholder.svg']
      );
    }
  });
  await removeFiles(oldImages);
  console.log(`Datos de ejemplo cargados: ${CATEGORIES.length} tipos y ${PRODUCTS.length} productos.`);
})().catch(error => {
  console.error('[ERROR] No se pudieron cargar los datos de ejemplo:', error);
  process.exitCode = 1;
}).finally(() => db.close());
