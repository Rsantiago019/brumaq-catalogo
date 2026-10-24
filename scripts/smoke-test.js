'use strict';

const crypto = require('crypto');
const db = require('../src/db');
const config = require('../src/config');

const args = new Set(process.argv.slice(2));
const testEmail = (process.env.SMOKE_TEST_EMAIL || '').trim().toLowerCase();
const adminEmail = (process.env.SMOKE_TEST_ADMIN_EMAIL || '').trim().toLowerCase();
const adminPassword = process.env.SMOKE_TEST_ADMIN_PASSWORD || '';

function requireConfig() {
  if (!args.has('--confirm-writes') || process.env.SMOKE_TEST_ALLOW_WRITES !== 'YES') {
    throw new Error(
      'La prueba crea y borra datos. Use --confirm-writes y defina SMOKE_TEST_ALLOW_WRITES=YES.'
    );
  }
  if (!args.has('--allow-production-writes')) {
    throw new Error('Agregue --allow-production-writes solo si autoriza que los servicios configurados puedan ser de producción.');
  }
  if (!config.databaseUrl || !config.jwtSecret || config.jwtSecret.length < 32) {
    throw new Error('Configure DATABASE_URL y un JWT_SECRET de al menos 32 caracteres.');
  }
  if (!config.blobToken) throw new Error('Configure BLOB_READ_WRITE_TOKEN.');
  if (!config.email.enabled) throw new Error('Configure SMTP y PUBLIC_BASE_URL para recuperación.');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(adminEmail) || !adminPassword) {
    throw new Error('Configure SMOKE_TEST_ADMIN_EMAIL y SMOKE_TEST_ADMIN_PASSWORD.');
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(testEmail)) {
    throw new Error('Configure SMOKE_TEST_EMAIL con un buzón dedicado que pueda recibir correo.');
  }
  if (testEmail === adminEmail) {
    throw new Error('SMOKE_TEST_EMAIL debe ser distinto de SMOKE_TEST_ADMIN_EMAIL.');
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function jsonResponse(response) {
  return response.json().catch(() => ({}));
}

function cookieFrom(response) {
  const value = response.headers.get('set-cookie');
  return value ? value.split(';', 1)[0] : '';
}

function createApi(origin) {
  return async function api(path, { method = 'GET', json, form, cookie = '' } = {}) {
    const headers = { Accept: 'application/json' };
    const options = { method, headers, redirect: 'manual' };
    if (cookie) headers.Cookie = cookie;
    if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
      headers.Origin = origin;
      headers['X-Requested-With'] = 'fetch';
    }
    if (json !== undefined) {
      headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(json);
    } else if (form) {
      options.body = form;
    }
    const response = await fetch(new URL(path, origin), options);
    return { response, data: await jsonResponse(response), cookie: cookieFrom(response) };
  };
}

async function expectStatus(result, status, action) {
  if (result.response.status !== status) {
    const detail = result.data.error || result.data.message || result.response.statusText;
    throw new Error(`${action}: se esperaba HTTP ${status}, se recibió ${result.response.status}${detail ? ` (${detail})` : ''}.`);
  }
  return result.data;
}

function report(message) {
  console.log(`✓ ${message}`);
}

async function run() {
  requireConfig();

  const emailService = require('../src/email');
  const sendPasswordReset = emailService.sendPasswordReset;
  let recoveryUrl = '';
  emailService.sendPasswordReset = async (recipient, url) => {
    recoveryUrl = url;
    return sendPasswordReset(recipient, url);
  };

  const app = require('../server');
  const { removeFiles } = require('../src/upload');
  let server;
  let databaseReady = false;
  let testUserCreated = false;
  let categoryId = null;
  let productId = null;
  let uploadedUrls = [];
  let failure = null;
  const cleanupErrors = [];

  try {
    await db.initialize();
    databaseReady = true;
    await db.query('SELECT 1');
    report('Conexión con Postgres y esquema disponibles.');

    const existing = await db.query('SELECT id FROM users WHERE LOWER(email) = $1', [testEmail]);
    assert(!existing.rowCount, 'SMOKE_TEST_EMAIL ya pertenece a una cuenta; use un buzón de prueba no registrado.');

    server = app.listen(0, '127.0.0.1');
    await new Promise((resolve, reject) => {
      server.once('listening', resolve);
      server.once('error', reject);
    });
    const address = server.address();
    const origin = `http://127.0.0.1:${address.port}`;
    const api = createApi(origin);

    const login = await api('/api/auth/login', {
      method: 'POST',
      json: { email: adminEmail, password: adminPassword }
    });
    await expectStatus(login, 200, 'Inicio de sesión del administrador');
    const adminCookie = login.cookie;
    assert(adminCookie, 'El login del administrador no devolvió una cookie de sesión.');
    report('Inicio de sesión de administrador.');

    const temporaryPassword = `Smoke-${crypto.randomBytes(16).toString('hex')}A1`;
    const createUser = await api('/api/admin/users', {
      method: 'POST',
      cookie: adminCookie,
      json: { email: testEmail, password: temporaryPassword }
    });
    await expectStatus(createUser, 201, 'Alta de cuenta temporal');
    testUserCreated = true;
    const userResult = await db.query('SELECT id FROM users WHERE LOWER(email) = $1', [testEmail]);
    assert(userResult.rowCount === 1, 'La cuenta temporal no aparece en la base de datos.');
    report('Alta de una cuenta temporal.');

    const testLogin = await api('/api/auth/login', {
      method: 'POST',
      json: { email: testEmail, password: temporaryPassword }
    });
    await expectStatus(testLogin, 200, 'Login de la cuenta temporal');
    report('Login de la cuenta creada.');

    const recovery = await api('/api/auth/password-recovery', {
      method: 'POST',
      json: { email: testEmail }
    });
    await expectStatus(recovery, 200, 'Solicitud de recuperación');
    assert(recoveryUrl, 'El servidor SMTP no envió el enlace de recuperación.');
    const resetToken = new URL(recoveryUrl).searchParams.get('token');
    assert(/^[a-f0-9]{64}$/.test(resetToken || ''), 'El enlace de recuperación no contiene un token válido.');
    report(`Solicitud de recuperación aceptada por SMTP para ${testEmail}.`);

    const resetPage = await fetch(new URL('/admin/reset-password.html', origin));
    assert(resetPage.ok, 'No se pudo cargar la página de restablecimiento de contraseña.');
    const resetHtml = await resetPage.text();
    assert(resetHtml.includes('reset-password.js'), 'La página de recuperación no cargó su formulario.');
    const newPassword = `Reset-${crypto.randomBytes(16).toString('hex')}B2`;
    const reset = await api('/api/auth/password-reset', {
      method: 'POST',
      json: { token: resetToken, password: newPassword }
    });
    await expectStatus(reset, 200, 'Restablecimiento de contraseña');
    assert(reset.data.ok === true, 'El restablecimiento no confirmó el cambio de contraseña.');
    const resetLogin = await api('/api/auth/login', {
      method: 'POST',
      json: { email: testEmail, password: newPassword }
    });
    await expectStatus(resetLogin, 200, 'Login después de restablecer la contraseña');
    report('Página, token de un solo uso y cambio de contraseña verificados.');

    const categoryName = `Prueba ${crypto.randomBytes(6).toString('hex')}`;
    const createCategory = await api('/api/admin/categories', {
      method: 'POST',
      cookie: adminCookie,
      json: { name: categoryName }
    });
    await expectStatus(createCategory, 201, 'Alta de tipo de producto');
    const category = createCategory.data.find(item => item.name === categoryName);
    const categoryResult = await db.query('SELECT id FROM categories WHERE name = $1', [categoryName]);
    assert(categoryResult.rowCount === 1, 'El tipo de producto creado no aparece en la base de datos.');
    categoryId = categoryResult.rows[0].id;
    assert(category, 'El tipo de producto creado no aparece en el listado.');
    report('Alta de tipo de producto temporal.');

    const image = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/SAAAAABJRU5ErkJggg==',
      'base64'
    );
    const form = new FormData();
    form.append('image', new Blob([image], { type: 'image/png' }), 'smoke-test.png');
    const upload = await api('/api/admin/uploads', { method: 'POST', cookie: adminCookie, form });
    await expectStatus(upload, 201, 'Carga de imagen a Blob');
    assert(upload.data.image?.url, 'La carga no devolvió una URL de imagen.');
    uploadedUrls.push(upload.data.image.url);
    report('Carga de imagen de prueba a Vercel Blob.');

    const productName = `Producto prueba ${crypto.randomBytes(6).toString('hex')}`;
    const createProduct = await api('/api/admin/products', {
      method: 'POST',
      cookie: adminCookie,
      json: {
        name: productName,
        category_id: categoryId,
        status: 'active',
        description: 'Producto temporal creado por la prueba de integración.',
        specs: [],
        images: uploadedUrls
      }
    });
    await expectStatus(createProduct, 201, 'Alta de producto');
    productId = createProduct.data.id;
    const productSlug = createProduct.data.slug;
    assert(createProduct.data.name === productName && createProduct.data.images.length === 1, 'El producto creado no contiene los datos esperados.');
    report('Alta de producto con imagen y categoría.');

    const publicProduct = await api(`/api/products/${encodeURIComponent(productSlug)}`);
    await expectStatus(publicProduct, 200, 'Consulta pública del producto');
    assert(publicProduct.data.name === productName, 'El producto no aparece en el catálogo público.');
    const imageResponse = await fetch(publicProduct.data.images[0].url, { method: 'HEAD' });
    assert(imageResponse.ok, `La imagen subida no está disponible públicamente (HTTP ${imageResponse.status}).`);
    report('Producto visible en el catálogo y su imagen accesible.');

    const deletion = await api(`/api/admin/products/${productId}`, {
      method: 'DELETE',
      cookie: adminCookie
    });
    await expectStatus(deletion, 200, 'Baja de producto');
    productId = null;
    uploadedUrls = [];
    const missingProduct = await api(`/api/products/${encodeURIComponent(productSlug)}`);
    await expectStatus(missingProduct, 404, 'Verificación de baja de producto');
    report('Baja de producto y eliminación de su imagen en Blob.');

    const deleteCategory = await api(`/api/admin/categories/${categoryId}`, {
      method: 'DELETE',
      cookie: adminCookie
    });
    await expectStatus(deleteCategory, 200, 'Limpieza del tipo de producto');
    categoryId = null;
  } catch (error) {
    failure = error;
  } finally {
    if (server) {
      await new Promise(resolve => server.close(resolve));
    }
    if (databaseReady) {
      let preserveProductImages = false;
      if (productId) {
        try {
          const images = await db.query('SELECT filename FROM product_images WHERE product_id = $1', [productId]);
          const urls = [...new Set([...images.rows.map(image => image.filename), ...uploadedUrls])];
          await db.query('DELETE FROM products WHERE id = $1', [productId]);
          productId = null;
          uploadedUrls = [];
          await removeFiles(urls);
        } catch (error) {
          preserveProductImages = productId !== null;
          cleanupErrors.push(`No se pudo limpiar el producto temporal: ${error.message}`);
        }
      }
      if (uploadedUrls.length && !preserveProductImages) {
        try {
          await removeFiles(uploadedUrls);
        } catch (error) {
          cleanupErrors.push(`No se pudo limpiar la imagen temporal de Blob: ${error.message}`);
        }
      }
      if (categoryId) {
        try {
          await db.query('DELETE FROM categories WHERE id = $1', [categoryId]);
        } catch (error) {
          cleanupErrors.push(`No se pudo limpiar la categoría temporal: ${error.message}`);
        }
      }
      if (testUserCreated) {
        try {
          await db.query('DELETE FROM users WHERE LOWER(email) = $1', [testEmail]);
        } catch (error) {
          cleanupErrors.push(`No se pudo limpiar la cuenta temporal: ${error.message}`);
        }
      }
    }
    try {
      await db.close();
    } catch (error) {
      cleanupErrors.push(`No se pudo cerrar la conexión con Postgres: ${error.message}`);
    }
  }

  if (failure || cleanupErrors.length) {
    const messages = [];
    if (failure) messages.push(failure.message);
    messages.push(...cleanupErrors);
    throw new Error(messages.join('\n'));
  }
  report('Limpieza de datos temporales completada.');
  console.log('\nPrueba de integración completada correctamente.');
}

run().catch(error => {
  console.error(`\n[ERROR] ${error.message}`);
  process.exitCode = 1;
});
