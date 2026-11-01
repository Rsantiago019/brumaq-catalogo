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
const PLACEHOLDER = '/img/placeholder.svg';

const state = { cfg: null, products: [], categories: [], category: 'all', cond: 'all', sort: 'recent', q: '' };

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
  const img = el('img', { src, alt, loading: 'lazy', decoding: 'async' });
  img.addEventListener('error', () => { if (!img.src.endsWith(PLACEHOLDER)) img.src = PLACEHOLDER; }, { once: true });
  return img;
}

/* Estado y "Destacado" se leen de las características del producto (sin cambios en la base de datos). */
const specOf = (p, label) => p.specs.find(s => norm(s.label).trim() === label)?.value;
function conditionOf(p) {
  const v = norm(specOf(p, 'estado') || '');
  return v.includes('usad') ? 'Usado' : v.includes('nuev') ? 'Nuevo' : null;
}
const isFeatured = p => {
  const v = specOf(p, 'destacado');
  return v != null && !/^(no|0|false)$/.test(norm(v).trim());
};
const shownSpecs = p => p.specs.filter(s => norm(s.label).trim() !== 'destacado');
const productUrl = p => `${location.origin}/p/${p.slug}`;

function toast(message) {
  const t = $('#toast');
  t.textContent = message;
  t.classList.add('is-on');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('is-on'), 2600);
}

/* ---------- WHATSAPP: mensaje dinámico con el nombre del producto ---------- */
function waLink(product) {
  const { whatsappNumber, whatsappMessage } = state.cfg;
  const message = whatsappMessage
    .replaceAll('{producto}', product.name)
    .replaceAll('{categoria}', product.category.name)
    .replaceAll('{url}', productUrl(product));
  return `https://wa.me/${whatsappNumber}?text=${encodeURIComponent(message)}`;
}

/* ---------- FILTROS Y ORDEN ---------- */
function visibleProducts() {
  const q = norm(state.q.trim());
  const list = state.products.filter(p =>
    (state.category === 'all' || p.category.slug === state.category) &&
    (state.cond === 'all' || conditionOf(p) === state.cond) &&
    (!q || norm(p.name).includes(q))
  );
  const byPrice = dir => (a, b) => {
    const pa = a.price == null ? null : Number(a.price);
    const pb = b.price == null ? null : Number(b.price);
    if (pa == null || pb == null) return pa == null && pb == null ? 0 : pa == null ? 1 : -1; // sin precio al final
    return dir * (pa - pb);
  };
  if (state.sort === 'price-asc') list.sort(byPrice(1));
  else if (state.sort === 'price-desc') list.sort(byPrice(-1));
  else if (state.sort === 'name') list.sort((a, b) => a.name.localeCompare(b.name, 'es'));
  return list;
}

function renderCondFilters() {
  const present = ['Nuevo', 'Usado'].filter(c => state.products.some(p => conditionOf(p) === c));
  const box = $('#condFilters');
  box.hidden = present.length === 0;
  box.replaceChildren(...(present.length ? ['all', ...present] : []).map(c => {
    const b = el('button', { class: 'seg__btn', type: 'button', 'aria-pressed': String(state.cond === c), text: c === 'all' ? 'Todos' : c });
    b.addEventListener('click', () => {
      state.cond = c;
      box.querySelectorAll('.seg__btn').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
      renderGrid();
    });
    return b;
  }));
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
  state.cond = 'all';
  $('#search').value = '';
  renderCondFilters();
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

function skeletons() {
  return Array.from({ length: 3 }, () => el('div', { class: 'card card--sk', 'aria-hidden': 'true' },
    el('div', { class: 'sk sk--img' }),
    el('div', { class: 'card__body' }, el('div', { class: 'sk sk--l1' }), el('div', { class: 'sk sk--l2' }), el('div', { class: 'sk sk--l3' }), el('div', { class: 'sk sk--btn' }))));
}

function card(p) {
  const img = p.images[0]?.url || PLACEHOLDER;
  const open = () => openDetail(p);
  const cond = conditionOf(p);
  const tags = [isFeatured(p) ? el('span', { class: 'tag tag--feat', text: '★ Destacado' }) : null,
    cond ? el('span', { class: `tag tag--${cond.toLowerCase()}`, text: cond }) : null].filter(Boolean);
  const mini = shownSpecs(p).filter(s => norm(s.label).trim() !== 'estado').slice(0, 2);
  return el('article', { class: 'card' },
    el('button', { class: 'card__img', type: 'button', 'aria-label': `Ver detalle de ${p.name}`, onclick: open },
      safeImg(img, p.name), el('span', { class: 'badge', text: p.category.name }),
      tags.length ? el('span', { class: 'card__tags' }, tags) : null),
    el('div', { class: 'card__body' },
      el('h3', {}, el('button', { type: 'button', text: p.name, onclick: open })),
      p.price != null ? el('p', { class: 'card__price', text: formatPrice(p.price) }) : null,
      mini.length
        ? el('ul', { class: 'mini' }, mini.map(s => el('li', {}, el('span', { text: s.label }), el('b', { text: s.value }))))
        : null,
      el('div', { class: 'card__cta' },
        el('a', { class: 'btn btn--wa', href: waLink(p), target: '_blank', rel: 'noopener', text: 'Consultar por WhatsApp' }),
                el('button', { class: 'card__more', type: 'button', text: 'Ver detalle →', onclick: open }))
    )
  );
}

/* ---------- DETALLE (ventana modal) ---------- */
const dlg = $('#detail');
let detailStep = () => {};
dlg.addEventListener('keydown', e => {
  if (e.key === 'ArrowLeft') detailStep(-1);
  else if (e.key === 'ArrowRight') detailStep(1);
});
let touchX = null;
dlg.addEventListener('touchstart', e => {
  const onImage = e.target.closest('.detail__main') && !e.target.closest('.detail__main.is-zoomed');
  touchX = onImage ? e.touches[0].clientX : null;
}, { passive: true });
dlg.addEventListener('touchend', e => {
  if (touchX == null) return;
  const dx = e.changedTouches[0].clientX - touchX;
  if (Math.abs(dx) > 40) detailStep(dx < 0 ? 1 : -1);
  touchX = null;
});
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
  const box = main.parentElement;
  box.querySelectorAll('.detail__nav, .detail__count').forEach(n => n.remove());
  let cur = 0;
  const zoomOut = () => { box.classList.remove('is-zoomed'); main.style.transformOrigin = ''; };
  const setOrigin = e => {
    const r = main.getBoundingClientRect();
    main.style.transformOrigin = `${((e.clientX - r.left) / r.width) * 100}% ${((e.clientY - r.top) / r.height) * 100}%`;
  };
  main.onclick = e => {
    const zoomed = box.classList.toggle('is-zoomed');
    if (zoomed) setOrigin(e); else main.style.transformOrigin = '';
  };
  box.onmousemove = e => { if (box.classList.contains('is-zoomed')) setOrigin(e); };
  const show = i => {
    zoomOut();
    cur = (i + urls.length) % urls.length;
    main.src = urls[cur];
    main.alt = `${p.name} (imagen ${cur + 1} de ${urls.length})`;
    document.querySelectorAll('#d-thumbs button').forEach((b, k) => b.setAttribute('aria-current', String(k === cur)));
    const count = box.querySelector('.detail__count');
    if (count) count.textContent = `${cur + 1} / ${urls.length}`;
  };
  detailStep = d => show(cur + d);
  if (urls.length > 1) {
    box.append(
      el('button', { class: 'detail__nav detail__nav--prev', type: 'button', 'aria-label': 'Imagen anterior', text: '‹', onclick: () => show(cur - 1) }),
      el('button', { class: 'detail__nav detail__nav--next', type: 'button', 'aria-label': 'Imagen siguiente', text: '›', onclick: () => show(cur + 1) }),
      el('span', { class: 'detail__count', 'aria-hidden': 'true' })
    );
  }
  main.onerror = () => { main.onerror = null; main.src = PLACEHOLDER; };
  $('#d-thumbs').replaceChildren(
    ...(urls.length > 1 ? urls.map((u, i) => el('button', { type: 'button', 'aria-label': `Ver imagen ${i + 1}`, onclick: () => show(i) }, safeImg(u, ''))) : [])
  );
  show(0);

  $('#d-specs').replaceChildren(...shownSpecs(p).map(s => el('div', {}, el('dt', { text: s.label }), el('dd', { text: s.value }))));

  const related = state.products.filter(r => r.id !== p.id && r.category.slug === p.category.slug).slice(0, 3);
  $('#d-related').hidden = related.length === 0;
  $('#d-related-list').replaceChildren(...related.map(r => el('button', { class: 'related__item', type: 'button', onclick: () => { openDetail(r); $('.detail__info').scrollTop = 0; } },
    safeImg(r.images[0]?.url || PLACEHOLDER, r.name),
    el('span', { class: 'related__name', text: r.name }),
    r.price != null ? el('span', { class: 'related__price', text: formatPrice(r.price) }) : null)));

  $('#d-share').onclick = async () => {
    const url = productUrl(p);
    if (navigator.share) {
      try { await navigator.share({ title: p.name, url }); return; } catch (e) { if (e.name === 'AbortError') return; }
    }
    try { await navigator.clipboard.writeText(url); toast('Enlace copiado'); } catch { toast(url); }
  };
  const inq = $('#d-inquiry');
  inq.hidden = !state.cfg.inquiryEnabled;
  inq.onclick = () => {
    dlg.close();
    $('#inqProduct').value = p.name;
    $('#contacto').scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth' });
    setTimeout(() => $('#inquiry [name=name]').focus({ preventScroll: true }), 500);
  };

  document.title = `${p.name} | ${state.cfg.businessName}`;
  $('meta[name=description]').content = `${p.name} (${p.category.name}) en ${state.cfg.businessName}. ${p.description || 'Consulte por WhatsApp.'}`.slice(0, 200);
  history.replaceState(null, '', `/p/${p.slug}`);
  if (!dlg.open) dlg.showModal();
}
$('#detailClose').addEventListener('click', () => dlg.close());
dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); }); // clic en el fondo
dlg.addEventListener('close', () => {
  history.replaceState(null, '', `/${location.search}`);
  if (state.cfg) {
    document.title = `Catálogo de maquinaria agrícola | ${state.cfg.businessName}`;
    $('meta[name=description]').content = DEFAULT_DESC;
  }
});
const DEFAULT_DESC = $('meta[name=description]').content;

/* ---------- FORMULARIO DE CONSULTA ---------- */
function setupInquiry() {
  const form = $('#inquiry');
  form.hidden = !state.cfg.inquiryEnabled;
  if (form.hidden) return;
  $('#inqProduct').append(...state.products.map(p => el('option', { value: p.name, text: p.name })));
  const msg = $('#inqMsg');
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const btn = form.querySelector('button[type=submit]');
    const data = Object.fromEntries(new FormData(form));
    msg.className = 'inquiry__msg';
    if (String(data.name).trim().length < 2 || String(data.contact).trim().length < 6 || String(data.message).trim().length < 5) {
      msg.textContent = 'Complete su nombre, un email o teléfono y su consulta.';
      msg.classList.add('is-err');
      return;
    }
    btn.disabled = true;
    msg.textContent = 'Enviando…';
    try {
      const r = await fetch('/api/inquiries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch' },
        body: JSON.stringify(data)
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body.error || 'No pudimos enviar su consulta.');
      form.reset();
      msg.textContent = '¡Gracias! Recibimos su consulta y le responderemos a la brevedad.';
      msg.classList.add('is-ok');
    } catch (err) {
      msg.textContent = err.message;
      msg.classList.add('is-err');
    } finally {
      btn.disabled = false;
    }
  });
}

/* ---------- EXTRAS DE PÁGINA: menú móvil, volver arriba, animaciones ---------- */
function setupPage() {
  const nav = $('#nav');
  const toggle = $('#navToggle');
  const setNav = open => {
    nav.classList.toggle('is-open', open);
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? 'Cerrar menú' : 'Abrir menú');
  };
  toggle.addEventListener('click', () => setNav(!nav.classList.contains('is-open')));
  nav.addEventListener('click', e => { if (e.target.closest('a')) setNav(false); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') setNav(false); });
  document.addEventListener('click', e => { if (!e.target.closest('.header')) setNav(false); });

  const top = $('#toTop');
  const onScroll = () => { top.hidden = window.scrollY < 700; };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
  top.addEventListener('click', () => window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' }));

  if (reduceMotion || !('IntersectionObserver' in window)) return;
  document.documentElement.classList.add('js');
  const targets = document.querySelectorAll('.trust__in li, .catalog__intro, .reel__txt, .reel__video, .why__grid article, .proof__grid figure, .faq__in > div, .faq details, .find__in > *, .contact__in > *');
  const io = new IntersectionObserver(entries => {
    for (const en of entries) {
      if (!en.isIntersecting) continue;
      const t = en.target;
      io.unobserve(t);
      t.classList.add('is-in');
      setTimeout(() => t.classList.remove('reveal', 'is-in'), 1000);
    }
  }, { threshold: 0.12 });
  targets.forEach(t => {
    const index = [...t.parentElement.children].indexOf(t);
    t.style.transitionDelay = `${Math.min(index, 4) * 70}ms`;
    t.classList.add('reveal');
    io.observe(t);
  });
}

/* ---------- INICIO ---------- */
async function init() {
  $('#year').textContent = new Date().getFullYear();
  setupPage();
  $('#grid').replaceChildren(...skeletons());
  $('#status').textContent = 'Cargando equipos…';
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
  renderCondFilters();
  $('#refine').hidden = state.products.length < 2;
  renderGrid();
  setupInquiry();

  $('#search').addEventListener('input', e => { state.q = e.target.value; renderGrid(); });
  $('#sort').addEventListener('change', e => { state.sort = e.target.value; renderGrid(); });

  const m = location.pathname.match(/^\/p\/([\w-]+)\/?$/) || location.hash.match(/^#producto=([\w-]+)$/);
  const linked = m && state.products.find(p => p.slug === m[1]);
  if (linked) openDetail(linked);
}
init();
