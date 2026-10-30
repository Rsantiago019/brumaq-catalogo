'use strict';
/* =====================================================================
   PANEL DE ADMINISTRACIÓN (este archivo solo se entrega con sesión válida)
   ===================================================================== */
const $ = (s, c = document) => c.querySelector(s);
const MAX_IMAGES = 8;
const state = { products: [], categories: [], editing: null, removeIds: new Set(), newFiles: [] };

function el(tag, props = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v);
  }
  for (const c of children.flat()) if (c != null) n.append(c);
  return n;
}

/* ---------- API ---------- */
async function api(path, { method = 'GET', json, form } = {}) {
  const headers = { 'X-Requested-With': 'fetch' };
  let body;
  if (json) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(json); }
  else if (form) body = form; // el navegador agrega el boundary multipart
  const r = await fetch(path, { method, headers, body, credentials: 'same-origin' });
  if (r.status === 401) { location.href = '/admin/login'; throw new Error('Sesión expirada.'); }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `Error ${r.status}`);
  return data;
}

let toastTimer;
function toast(msg, isError = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast show' + (isError ? ' toast--error' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.className = 'toast'), 4500);
}
function confirmAction(title, message, acceptLabel = 'Borrar') {
  const dialog = $('#confirmDialog');
  $('#confirmTitle').textContent = title;
  $('#confirmMessage').textContent = message;
  $('#confirmAccept').textContent = acceptLabel;
  dialog.showModal();
  return new Promise(resolve => {
    dialog.addEventListener('close', () => resolve(dialog.returnValue === 'confirm'), { once: true });
  });
}
const fmtDate = value => new Date(value).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });

/* ---------- Sesión / pestañas ---------- */
async function loadSession() {
  const { user } = await api('/api/auth/me');
  $('#userEmail').textContent = user.email;
  $('#createUserBlock').hidden = user.role !== 'admin';
}
$('#logout').addEventListener('click', async () => {
  await api('/api/auth/logout', { method: 'POST' }).catch(() => {});
  location.href = '/admin/login';
});
function showTab(name) {
  for (const t of ['products', 'categories', 'users']) {
    $(`#tab-${t}`).setAttribute('aria-selected', String(t === name));
    $(`#view-${t}`).hidden = t !== name;
  }
}
$('#tab-products').addEventListener('click', () => showTab('products'));
$('#tab-categories').addEventListener('click', () => showTab('categories'));
$('#tab-users').addEventListener('click', () => showTab('users'));

$('#createUserForm').addEventListener('submit', async e => {
  e.preventDefault();
  const form = e.currentTarget;
  const error = $('#createUserError');
  error.textContent = '';
  $('#createUserSubmit').disabled = true;
  try {
    await api('/api/admin/users', {
      method: 'POST',
      json: { email: form.elements.email.value.trim(), password: form.elements.password.value }
    });
    form.reset();
    toast('Cuenta de administrador creada.');
  } catch (err) {
    error.textContent = err.message;
  } finally {
    $('#createUserSubmit').disabled = false;
  }
});

$('#changePasswordForm').addEventListener('submit', async e => {
  e.preventDefault();
  const form = e.currentTarget;
  const error = $('#changePasswordError');
  error.textContent = '';
  if (form.elements.newPassword.value !== form.elements.confirmation.value) {
    error.textContent = 'Las contraseñas nuevas no coinciden.';
    return;
  }
  $('#changePasswordSubmit').disabled = true;
  try {
    await api('/api/admin/password', {
      method: 'PUT',
      json: {
        currentPassword: form.elements.currentPassword.value,
        newPassword: form.elements.newPassword.value
      }
    });
    location.href = '/admin/login';
  } catch (err) {
    error.textContent = err.message;
  } finally {
    $('#changePasswordSubmit').disabled = false;
  }
});

/* ---------- LISTADO DE PRODUCTOS ---------- */
async function loadProducts() {
  state.products = await api('/api/admin/products');
  renderProducts();
}
function renderProducts() {
  $('#count').textContent = `(${state.products.length})`;
  const rows = state.products.map(p => {
    const thumb = p.images[0]
      ? el('img', { class: 'thumb', src: p.images[0].url, alt: '' })
      : el('span', { class: 'thumb thumb--empty', text: 'Sin foto' });
    const status = el('button', {
      class: `pill pill--${p.status}`, type: 'button', title: 'Clic para cambiar el estado',
      text: p.status === 'active' ? 'Activo' : 'Inactivo',
      onclick: () => toggleStatus(p)
    });
    return el('tr', {},
      el('td', {}, thumb),
      el('td', {}, el('strong', { text: p.name }), el('div', { class: 'muted', text: `${p.images.length} imagen(es) · ${p.specs.length} característica(s)` })),
      el('td', { text: p.category }),
      el('td', {}, status),
      el('td', { text: fmtDate(p.updated_at) }),
      el('td', { class: 'right actions' },
        el('button', { class: 'btn btn--ghost btn--sm', type: 'button', text: 'Editar', onclick: () => openForm(p) }),
        el('button', { class: 'btn btn--danger btn--sm', type: 'button', text: 'Borrar', onclick: () => removeProduct(p) }))
    );
  });
  $('#productRows').replaceChildren(...(rows.length ? rows : [el('tr', {}, el('td', { colspan: 6, class: 'empty', text: 'Todavía no hay productos. Cree el primero con “Nuevo producto”.' }))]));
}
async function toggleStatus(p) {
  try {
    await api(`/api/admin/products/${p.id}`, { method: 'PUT', json: { status: p.status === 'active' ? 'inactive' : 'active' } });
    toast('Estado actualizado.');
    await loadProducts();
  } catch (e) { toast(e.message, true); }
}
async function removeProduct(p) {
  if (!(await confirmAction('Borrar producto', `¿Borrar "${p.name}" y sus imágenes? Esta acción no se puede deshacer.`))) return;
  try {
    await api(`/api/admin/products/${p.id}`, { method: 'DELETE' });
    toast('Producto borrado.');
    await loadProducts();
    await loadCategories();
  } catch (e) { toast(e.message, true); }
}

/* ---------- FORMULARIO (crear / editar) ---------- */
const dlg = $('#productDialog');
const form = $('#productForm');

function addSpecRow(label = '', value = '') {
  const row = el('div', { class: 'spec-row' },
    el('input', { name: 'spec_label', placeholder: 'Característica (ej. Potencia)', list: 'specNames', maxlength: '60', value: label, 'aria-label': 'Nombre de la característica' }),
    el('input', { name: 'spec_value', placeholder: 'Valor (ej. 110 HP)', maxlength: '200', value, 'aria-label': 'Valor' }),
    el('button', { class: 'x x--sm', type: 'button', 'aria-label': 'Quitar característica', text: '×', onclick: () => row.remove() }));
  $('#specRows').append(row);
}
function readSpecs() {
  return [...document.querySelectorAll('.spec-row')]
    .map(r => ({ label: r.children[0].value.trim(), value: r.children[1].value.trim() }))
    .filter(s => s.label || s.value);
}
function renderCurrentImages() {
  const p = state.editing;
  const imgs = p ? p.images : [];
  $('#currentImages').replaceChildren(...imgs.map(i => {
    const marked = state.removeIds.has(i.id);
    return el('figure', { class: 'imgbox' + (marked ? ' imgbox--removed' : '') },
      el('img', { src: i.url, alt: '' }),
      el('button', { type: 'button', class: 'imgbox__btn', text: marked ? 'Restaurar' : 'Quitar',
        onclick: () => { marked ? state.removeIds.delete(i.id) : state.removeIds.add(i.id); renderCurrentImages(); updateImgHint(); } }));
  }));
}
function renderNewImages() {
  $('#newImages').replaceChildren(...state.newFiles.map((f, idx) =>
    el('figure', { class: 'imgbox' },
      el('img', { src: URL.createObjectURL(f), alt: '' }),
      el('button', { type: 'button', class: 'imgbox__btn', text: 'Quitar', onclick: () => { state.newFiles.splice(idx, 1); renderNewImages(); updateImgHint(); } }))));
}
function keptCount() { return (state.editing ? state.editing.images.length - state.removeIds.size : 0) + state.newFiles.length; }
function updateImgHint() { $('#imgHint').textContent = `${keptCount()} de ${MAX_IMAGES} imágenes.`; }

$('#files').addEventListener('change', e => {
  const ok = ['image/jpeg', 'image/png', 'image/webp'];
  for (const f of e.target.files) {
    if (!ok.includes(f.type)) { toast(`"${f.name}": formato no permitido.`, true); continue; }
    if (f.size > 4 * 1024 * 1024) { toast(`"${f.name}" supera los 4 MB.`, true); continue; }
    if (keptCount() >= MAX_IMAGES) { toast(`Máximo ${MAX_IMAGES} imágenes.`, true); break; }
    state.newFiles.push(f);
  }
  e.target.value = '';
  renderNewImages(); updateImgHint();
});
$('#addSpec').addEventListener('click', () => addSpecRow());

function openForm(p = null) {
  state.editing = p;
  state.removeIds = new Set();
  state.newFiles = [];
  $('#pd-title').textContent = p ? 'Editar producto' : 'Nuevo producto';
  $('#formError').textContent = '';
  form.elements.name.value = p?.name ?? '';
  form.description.value = p?.description ?? '';
  form.status.value = p?.status ?? 'active';
  form.category_id.replaceChildren(...state.categories.map(c => el('option', { value: c.id, text: c.name })));
  if (p) form.category_id.value = p.category_id;
  $('#specRows').replaceChildren();
  (p?.specs.length ? p.specs : [{ label: '', value: '' }]).forEach(s => addSpecRow(s.label, s.value));
  renderCurrentImages(); renderNewImages(); updateImgHint();
  dlg.showModal();
}
$('#newProduct').addEventListener('click', () => {
  if (!state.categories.length) { toast('Primero cree al menos un tipo de producto.', true); showTab('categories'); return; }
  openForm();
});
const closeForm = () => dlg.close();
$('#pdClose').addEventListener('click', closeForm);
$('#pdCancel').addEventListener('click', closeForm);

form.addEventListener('submit', async e => {
  e.preventDefault();
  const err = $('#formError');
  err.textContent = '';
  if (form.elements.name.value.trim().length < 2) { err.textContent = 'Ingrese el nombre del producto.'; form.elements.name.focus(); return; }
  if (readSpecs().some(s => !s.label || !s.value)) { err.textContent = 'Complete nombre y valor de cada característica, o quite la fila vacía.'; return; }

  $('#pdSave').disabled = true;
  const uploaded = [];
  let saved = false;
  try {
    for (const file of state.newFiles) {
      const formData = new FormData();
      formData.append('image', file);
      const result = await api('/api/admin/uploads', { method: 'POST', form: formData });
      uploaded.push(result.image.url);
    }

    const json = {
      name: form.elements.name.value.trim(),
      category_id: form.category_id.value,
      status: form.status.value,
      description: form.description.value,
      specs: readSpecs(),
      images: uploaded
    };
    if (state.editing) json.remove_images = [...state.removeIds];
    const url = state.editing ? `/api/admin/products/${state.editing.id}` : '/api/admin/products';
    await api(url, { method: state.editing ? 'PUT' : 'POST', json });
    saved = true;
    dlg.close();
    toast(state.editing ? 'Producto actualizado.' : 'Producto creado.');
    await loadProducts();
    await loadCategories();
  } catch (e2) {
    err.textContent = e2.message;
  } finally {
    if (!saved && uploaded.length) {
      try { await api('/api/admin/uploads', { method: 'DELETE', json: { urls: uploaded } }); }
      catch (cleanupError) { console.error('No se pudieron limpiar las imágenes temporales:', cleanupError); }
    }
    $('#pdSave').disabled = false;
  }
});

/* ---------- TIPOS DE PRODUCTO ---------- */
async function loadCategories() {
  state.categories = await api('/api/admin/categories');
  renderCategories();
}
function renderCategories() {
  $('#catRows').replaceChildren(...state.categories.map(c => {
    const input = el('input', { value: c.name, maxlength: '60', 'aria-label': `Nombre del tipo ${c.name}` });
    return el('tr', {},
      el('td', {}, input),
      el('td', { text: String(c.products) }),
      el('td', { class: 'right actions' },
        el('button', { class: 'btn btn--ghost btn--sm', type: 'button', text: 'Guardar', onclick: async () => {
          try { state.categories = await api(`/api/admin/categories/${c.id}`, { method: 'PUT', json: { name: input.value } }); renderCategories(); toast('Tipo actualizado.'); await loadProducts(); }
          catch (e) { toast(e.message, true); }
        } }),
        el('button', { class: 'btn btn--danger btn--sm', type: 'button', text: 'Borrar', onclick: async () => {
          if (!(await confirmAction('Borrar tipo de producto', `¿Borrar el tipo "${c.name}"?`))) return;
          try { state.categories = await api(`/api/admin/categories/${c.id}`, { method: 'DELETE' }); renderCategories(); toast('Tipo borrado.'); }
          catch (e) { toast(e.message, true); }
        } })));
  }));
}
$('#catForm').addEventListener('submit', async e => {
  e.preventDefault();
  const input = e.target.elements.name;
  try {
    state.categories = await api('/api/admin/categories', { method: 'POST', json: { name: input.value } });
    input.value = '';
    renderCategories();
    toast('Tipo agregado.');
  } catch (err) { toast(err.message, true); }
});

/* ---------- Inicio ---------- */
(async () => {
  try {
    await loadSession();
    await loadCategories();
    await loadProducts();
  } catch (e) { toast(e.message, true); }
})();
