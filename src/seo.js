'use strict';
const fs = require('fs');
const path = require('path');
const db = require('./db');
const config = require('./config');

const escapeHtml = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const origin = req => `${req.protocol}://${req.get('host')}`;
const absolute = (url, base) => (/^https?:\/\//.test(url) ? url : `${base}${url.startsWith('/') ? '' : '/'}${url}`);

let template;
const readTemplate = () => {
  if (!template || !config.isProd) template = fs.readFileSync(path.join(config.publicDir, 'index.html'), 'utf8');
  return template;
};

const specValue = (specs, label) => (specs || []).find(s => String(s.label).trim().toLowerCase() === label)?.value;

async function findProduct(slug) {
  const { rows } = await db.query(
    `SELECT p.id, p.name, p.slug, p.description, p.specs, p.price, c.name AS category
     FROM products p JOIN categories c ON c.id = p.category_id
     WHERE p.status = 'active' AND p.slug = $1`,
    [slug]
  );
  const product = rows[0];
  if (!product) return null;
  const { rows: images } = await db.query(
    'SELECT filename FROM product_images WHERE product_id = $1 ORDER BY position, id LIMIT 1',
    [product.id]
  );
  product.image = images[0]?.filename || null;
  return product;
}

function productHead(product, base) {
  const price = product.price != null ? ` · $ ${Number(product.price).toLocaleString('es-AR')}` : '';
  const title = `${product.name} | ${config.business.name}`;
  const description = (product.description || `${product.name} (${product.category}) disponible en ${config.business.name}. Consulte por WhatsApp.`)
    .replace(/\s+/g, ' ').slice(0, 200) + price;
  const url = `${base}/p/${encodeURIComponent(product.slug)}`;
  const image = product.image ? absolute(product.image, base) : `${base}/img/hero-poster.jpg`;
  const condition = String(specValue(product.specs, 'estado') || '').toLowerCase();
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.name,
    description,
    category: product.category,
    image,
    url,
    ...(condition.includes('usado') && { itemCondition: 'https://schema.org/UsedCondition' }),
    ...(condition.includes('nuevo') && { itemCondition: 'https://schema.org/NewCondition' }),
    ...(product.price != null && {
      offers: { '@type': 'Offer', price: Number(product.price), priceCurrency: 'ARS', availability: 'https://schema.org/InStock', url }
    })
  };
  return { title, description, url, image, ld };
}

function inject(html, head) {
  return html
    .replace(/<meta property="og:[^>]*>\n?/g, '')
    .replace(/<title>[\s\S]*?<\/title>/, () => `<title>${escapeHtml(head.title)}</title>`)
    .replace(/<meta name="description"[^>]*>/, () => `<meta name="description" content="${escapeHtml(head.description)}">`)
    .replace('</head>', () =>
      `<link rel="canonical" href="${escapeHtml(head.url)}">\n` +
      `<meta property="og:type" content="product">\n` +
      `<meta property="og:title" content="${escapeHtml(head.title)}">\n` +
      `<meta property="og:description" content="${escapeHtml(head.description)}">\n` +
      `<meta property="og:url" content="${escapeHtml(head.url)}">\n` +
      `<meta property="og:image" content="${escapeHtml(head.image)}">\n` +
      `<meta name="twitter:card" content="summary_large_image">\n` +
      `<script type="application/ld+json">${JSON.stringify(head.ld).replace(/</g, '\\u003c')}</script>\n</head>`
    );
}

async function productPage(req, res, next) {
  const product = await findProduct(req.params.slug);
  const html = readTemplate().replace('<head>', '<head>\n<base href="/">');
  if (!product) return res.status(404).type('html').send(html);
  res.type('html').send(inject(html, productHead(product, origin(req))));
}

async function sitemap(req, res) {
  const base = origin(req);
  const { rows } = await db.query("SELECT slug FROM products WHERE status = 'active' ORDER BY id");
  const urls = [`${base}/`, ...rows.map(r => `${base}/p/${encodeURIComponent(r.slug)}`)];
  res.type('application/xml').send(
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls.map(u => `  <url><loc>${escapeHtml(u)}</loc></url>`).join('\n') + '\n</urlset>\n'
  );
}

const robots = (req, res) =>
  res.type('text/plain').send(`User-agent: *\nDisallow: /admin\nDisallow: /api/\n\nSitemap: ${origin(req)}/sitemap.xml\n`);

module.exports = { productPage, sitemap, robots };
