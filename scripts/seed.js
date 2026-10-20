'use strict';
/* Carga datos de EJEMPLO para ver el catálogo funcionando.
 *   npm run seed            (no hace nada si ya hay productos)
 *   npm run seed -- --reset (borra productos y tipos actuales y vuelve a cargar los de ejemplo)
 * Los textos y especificaciones son ilustrativos: reemplácelos desde el panel con los datos reales.
 */
const fs = require('fs');
const path = require('path');
const db = require('../src/db');
const config = require('../src/config');
const { slugify } = require('../src/utils');
const { removeFiles } = require('../src/upload');

const reset = process.argv.includes('--reset');
const existing = db.prepare('SELECT COUNT(*) AS n FROM products').get().n;
if (existing && !reset) {
  console.log('Ya hay productos cargados. Use --reset para reemplazarlos por los de ejemplo.');
  process.exit(0);
}
if (reset) {
  const files = db.prepare('SELECT filename FROM product_images').all().map(r => r.filename);
  db.exec('DELETE FROM products; DELETE FROM categories;');
  removeFiles(files);
}

const CATEGORIES = ['Tractores', 'Trilladoras', 'Cosechadoras', 'Arados', 'Rastras', 'Sembradoras', 'Implementos y repuestos'];
const NOTE = ' Ficha de ejemplo: reemplace estos datos por los del producto real desde el panel.';

const PRODUCTS = [
  { name: 'Tractor 4x4 modelo ejemplo', cat: 'Tractores', img: 'tractores', status: 'active',
    description: 'Tractor versátil para labranza, siembra y transporte.' + NOTE,
    specs: [['Potencia', '110 HP'], ['Tracción', '4x4'], ['Transmisión', 'Mecánica 12x12'], ['Uso', 'Labranza y siembra']] },
  { name: 'Trilladora estacionaria modelo ejemplo', cat: 'Trilladoras', img: 'trilladoras', status: 'active',
    description: 'Trilladora para cereales y forrajes con alimentación lateral.' + NOTE,
    specs: [['Tipo', 'Estacionaria'], ['Accionamiento', 'Toma de fuerza'], ['Cultivos', 'Trigo, avena, cebada'], ['Capacidad', 'Según cultivo']] },
  { name: 'Cosechadora autopropulsada modelo ejemplo', cat: 'Cosechadoras', img: 'cosechadoras', status: 'active',
    description: 'Cosechadora de granos con plataforma de corte frontal.' + NOTE,
    specs: [['Tipo', 'Autopropulsada'], ['Plataforma', '4,5 m'], ['Tolva', '6.000 L'], ['Cultivos', 'Cereales y oleaginosas']] },
  { name: 'Arado de reja modelo ejemplo', cat: 'Arados', img: 'arados', status: 'active',
    description: 'Arado reversible para labranza primaria del suelo.' + NOTE,
    specs: [['Cuerpos', '3'], ['Enganche', '3 puntos'], ['Tractor sugerido', '70–100 HP'], ['Uso', 'Labranza primaria']] },
  { name: 'Rastra de discos modelo ejemplo', cat: 'Rastras', img: 'rastras', status: 'active',
    description: 'Rastra de doble acción para afinar el suelo antes de la siembra.' + NOTE,
    specs: [['Discos', '24'], ['Ancho de trabajo', '2,8 m'], ['Enganche', 'De arrastre'], ['Tractor sugerido', '80–120 HP']] },
  { name: 'Sembradora de granos modelo ejemplo', cat: 'Sembradoras', img: 'sembradoras', status: 'active',
    description: 'Sembradora para pasturas, cereales y forrajes.' + NOTE,
    specs: [['Líneas', '13'], ['Tolva', '600 L'], ['Distribución', 'Mecánica'], ['Uso', 'Siembra directa y convencional']] },
  { name: 'Kit de repuestos de labranza modelo ejemplo', cat: 'Implementos y repuestos', img: 'repuestos', status: 'active',
    description: 'Rejas, discos y piezas de desgaste para implementos de labranza.' + NOTE,
    specs: [['Contenido', 'Rejas, discos y bulonería'], ['Compatibilidad', 'Consultar modelo']] },
  { name: 'Tractor borrador (inactivo)', cat: 'Tractores', img: 'tractores', status: 'inactive',
    description: 'Ejemplo de producto inactivo: no se muestra en el catálogo público.',
    specs: [['Estado', 'En preparación']] }
];

db.transaction(() => {
  const insCat = db.prepare('INSERT INTO categories (name, slug, position) VALUES (?, ?, ?)');
  const catId = {};
  CATEGORIES.forEach((n, i) => (catId[n] = insCat.run(n, slugify(n), i + 1).lastInsertRowid));

  const insProd = db.prepare(
    'INSERT INTO products (name, slug, category_id, description, specs, status) VALUES (?, ?, ?, ?, ?, ?)'
  );
  const insImg = db.prepare('INSERT INTO product_images (product_id, filename, position) VALUES (?, ?, 0)');

  for (const p of PRODUCTS) {
    const specs = JSON.stringify(p.specs.map(([label, value]) => ({ label, value })));
    const id = insProd.run(p.name, slugify(p.name), catId[p.cat], p.description, specs, p.status).lastInsertRowid;
    const file = `demo-${p.img}-${id}.svg`;
    fs.copyFileSync(path.join(config.root, 'seed-assets', `${p.img}.svg`), path.join(config.uploadDir, file));
    insImg.run(id, file);
  }
})();

console.log(`Datos de ejemplo cargados: ${CATEGORIES.length} tipos y ${PRODUCTS.length} productos.`);
