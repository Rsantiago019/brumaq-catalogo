'use strict';
/* =====================================================================
   CATÁLOGO PÚBLICO
   - Carga productos activos desde /api.
   - Filtro por "tipo de producto" + buscador, sin recargar la página.
   - Cada producto genera su enlace de WhatsApp con el nombre incluido.
   - Todo el texto proveniente de la base se inserta con textContent (anti-XSS).
   ===================================================================== */
const $ = (s, c = document) => c.querySelector(s);
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const PLACEHOLDER = 'img/placeholder.svg';

const state = { cfg: null, products: [], categories: [], category: 'all', q: '' };

/* ---------- utilidades ---------- */
function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  for (const c of children.flat()) if (c != null) node.append(c);
  return node;
}
const norm = s => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const formatPrice = price => new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  minimumFractionDigits: 0,
  maximumFractionDigits: 2
}).format(Number(price));
const api = async path => {
  const r = await fetch(path, { headers: { Accept: 'application/json' } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
};
function safeImg(src, alt) {
  const img = el('img', { src, alt, loading: 'lazy' });
  img.addEventListener('error', () => { if (!img.src.endsWith(PLACEHOLDER)) img.src = PLACEHOLDER; }, { once: true });
  return img;
}

/* ---------- WHATSAPP: mensaje dinámico con el nombre del producto ---------- */
function waLink(product) {
  const { whatsappNumber, whatsappMessage } = state.cfg;
  const message = whatsappMessage
    .replaceAll('{producto}', product.name)
    .replaceAll('{categoria}', product.category.name)
    .replaceAll('{url}', `${location.origin}/#producto=${product.slug}`);
  return `https://wa.me/${whatsappNumber}?text=${encodeURIComponent(message)}`;
}

/* ---------- FILTROS ---------- */
function visibleProducts() {
  const q = norm(state.q.trim());
  return state.products.filter(p =>
    (state.category === 'all' || p.category.slug === state.category) && (!q || norm(p.name).includes(q))
  );
}

function renderFilters() {
  const box = $('#filters');
  box.replaceChildren();
  const make = (slug, label, count) => {
    const b = el('button', { class: 'chip', type: 'button', 'aria-pressed': String(state.category === slug), 'data-slug': slug },
      label, count != null ? el('small', { text: `(${count})` }) : null);
    b.addEventListener('click', () => setCategory(slug));
    return b;
  };
  box.append(make('all', 'Todos', state.products.length), ...state.categories.map(c => make(c.slug, c.name, c.count)));
}

function setCategory(slug) {
  state.category = slug;
  const url = new URL(location.href);
  slug === 'all' ? url.searchParams.delete('tipo') : url.searchParams.set('tipo', slug);
  history.replaceState(null, '', url);
  document.querySelectorAll('.chip').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.slug === slug)));
  renderGrid();
}

function clearFilters() {
  state.q = '';
  $('#search').value = '';
  setCategory('all');
}

/* ---------- TARJETAS ---------- */
function renderGrid() {
  const list = visibleProducts();
  const grid = $('#grid');
  if (list.length) {
    grid.replaceChildren(...list.map(card));
  } else {
    const filtered = state.q.trim() || state.category !== 'all';
    grid.replaceChildren(el('div', { class: 'empty-state' },
      el('h3', { text: filtered ? 'No encontramos ese equipo' : 'Estamos preparando el catálogo' }),
      el('p', { text: filtered
        ? 'Pruebe con otro nombre o tipo de producto.'
        : 'Mientras tanto, escríbanos y le ayudamos a encontrar el equipo adecuado.' }),
      filtered
        ? el('button', { class: 'btn btn--line', type: 'button', text: 'Limpiar filtros', onclick: clearFilters })
        : el('a', { class: 'btn btn--wa', href: '#contacto', text: 'Consultar por WhatsApp' })));
  }
  $('#status').textContent = state.products.length
    ? list.length ? `Mostrando ${list.length} de ${state.products.length} productos.` : 'No hay productos que coincidan con su búsqueda.'
    : 'Pronto publicaremos nuestros equipos. Consúltenos por WhatsApp.';
  if (window.gsap && !reduceMotion && list.length) {
    gsap.from('.card', { y: 28, opacity: 0, duration: 0.5, stagger: 0.05, ease: 'power2.out', clearProps: 'all' });
  }
}

function card(p) {
  const img = p.images[0]?.url || PLACEHOLDER;
  const open = () => openDetail(p);
  return el('article', { class: 'card' },
    el('button', { class: 'card__img', type: 'button', 'aria-label': `Ver detalle de ${p.name}`, onclick: open },
      safeImg(img, p.name), el('span', { class: 'badge', text: p.category.name })),
    el('div', { class: 'card__body' },
      el('h3', {}, el('button', { type: 'button', text: p.name, onclick: open })),
      p.price != null ? el('p', { class: 'card__price', text: formatPrice(p.price) }) : null,
      p.specs.length
        ? el('ul', { class: 'mini' }, p.specs.slice(0, 3).map(s => el('li', {}, el('span', { text: s.label }), el('b', { text: s.value }))))
        : null,
      el('div', { class: 'card__cta' },
        el('a', { class: 'btn btn--wa', href: waLink(p), target: '_blank', rel: 'noopener', text: 'Consultar por WhatsApp' }),
        el('button', { class: 'btn btn--line', type: 'button', text: 'Ver detalle', onclick: open }))
    )
  );
}

/* ---------- DETALLE (ventana modal) ---------- */
const dlg = $('#detail');
function openDetail(p) {
  $('#d-cat').textContent = p.category.name;
  $('#d-name').textContent = p.name;
  const price = $('#d-price');
  price.textContent = p.price != null ? formatPrice(p.price) : '';
  price.hidden = p.price == null;
  $('#d-desc').textContent = p.description;
  $('#d-desc').hidden = !p.description;
  $('#d-wa').href = waLink(p);

  const urls = p.images.length ? p.images.map(i => i.url) : [PLACEHOLDER];
  const main = $('#d-main');
  const show = i => {
    main.src = urls[i];
    main.alt = `${p.name} (imagen ${i + 1} de ${urls.length})`;
    document.querySelectorAll('#d-thumbs button').forEach((b, k) => b.setAttribute('aria-current', String(k === i)));
  };
  main.onerror = () => { main.onerror = null; main.src = PLACEHOLDER; };
  $('#d-thumbs').replaceChildren(
    ...(urls.length > 1 ? urls.map((u, i) => el('button', { type: 'button', 'aria-label': `Ver imagen ${i + 1}`, onclick: () => show(i) }, safeImg(u, ''))) : [])
  );
  show(0);

  $('#d-specs').replaceChildren(...p.specs.map(s => el('div', {}, el('dt', { text: s.label }), el('dd', { text: s.value }))));
  history.replaceState(null, '', `#producto=${p.slug}`);
  if (!dlg.open) dlg.showModal();
}
$('#detailClose').addEventListener('click', () => dlg.close());
dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); }); // clic en el fondo
dlg.addEventListener('close', () => history.replaceState(null, '', location.pathname + location.search));

/* ---------- INICIO ---------- */
async function init() {
  $('#year').textContent = new Date().getFullYear();
  try {
    const [cfg, categories, products] = await Promise.all([api('/api/config'), api('/api/categories'), api('/api/products')]);
    Object.assign(state, { cfg, categories, products });
  } catch {
    $('#status').textContent = '';
    $('#grid').replaceChildren(el('div', { class: 'empty-state', role: 'alert' },
      el('h3', { text: 'No pudimos cargar el catálogo' }),
      el('p', { text: 'Revise su conexión e intente nuevamente.' }),
      el('button', { class: 'btn', type: 'button', text: 'Reintentar', onclick: () => location.reload() })));
    return;
  }
  const { cfg } = state;
  document.title = `Catálogo de maquinaria agrícola | ${cfg.businessName}`;
  $('#bizName').textContent = cfg.businessName;
  $('#mapText').textContent = cfg.mapQuery;
  $('#mapFrame').src = `https://maps.google.com/maps?q=${encodeURIComponent(cfg.mapQuery)}&z=14&ie=UTF8&iwloc=&output=embed`;
  $('#igLink').href = `https://www.instagram.com/${encodeURIComponent(cfg.instagram)}/`;
  const general = `https://wa.me/${cfg.whatsappNumber}?text=${encodeURIComponent('Hola, quisiera consultar por maquinaria agrícola.')}`;
  $('#waGeneral').href = general;
  $('#waFloat').href = general;

  const want = new URLSearchParams(location.search).get('tipo');
  if (want && state.categories.some(c => c.slug === want)) state.category = want;
  renderFilters();
  renderGrid();

  $('#search').addEventListener('input', e => { state.q = e.target.value; renderGrid(); });

  const m = location.hash.match(/^#producto=([\w-]+)$/);
  const linked = m && state.products.find(p => p.slug === m[1]);
  if (linked) openDetail(linked);
}
init();
