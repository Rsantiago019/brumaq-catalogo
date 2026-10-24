'use strict';
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const path = require('path');
const config = require('./src/config');
config.assertSecure();
const db = require('./src/db');

const { authPage, authRequired, csrfGuard, readUser } = require('./src/auth');
const publicRoutes = require('./src/routes/public');
const authRoutes = require('./src/routes/auth');
const adminRoutes = require('./src/routes/admin');

const app = express();
app.disable('x-powered-by');
if (config.trustProxy) app.set('trust proxy', 1);

app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", 'https://cdnjs.cloudflare.com'],
        styleSrc: ["'self'", 'https://fonts.googleapis.com'],
        fontSrc: ['https://fonts.gstatic.com'],
        imgSrc: ["'self'", 'data:', 'blob:', 'https://*.public.blob.vercel-storage.com'],
        frameSrc: ['https://www.google.com', 'https://maps.google.com'],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        upgradeInsecureRequests: config.isProd ? [] : null
      }
    }
  })
);
app.use(cookieParser());
app.use(express.json({ limit: '100kb' }));
app.use(express.static(config.publicDir, { maxAge: config.isProd ? '1h' : 0 }));

// API
app.use('/api', csrfGuard);
app.use('/api/auth', authRoutes);
app.use('/api/admin', authRequired, adminRoutes);
app.use('/api', publicRoutes);
app.get('/api/health', async (req, res) => {
  await db.query('SELECT 1');
  res.json({ ok: true });
});
app.use('/api', (req, res) => res.status(404).json({ error: 'No encontrado.' }));

// Páginas del panel (el HTML y el JS del panel solo se entregan con sesión válida)
const noStore = (req, res, next) => (res.set('Cache-Control', 'no-store'), next());
app.get('/admin/login', noStore, async (req, res) =>
  await readUser(req) ? res.redirect('/admin') : res.sendFile(path.join(config.viewsDir, 'login.html'))
);
app.get('/admin/reset-password', noStore, async (req, res) =>
  await readUser(req) ? res.redirect('/admin') : res.sendFile(path.join(config.publicDir, 'admin', 'reset-password.html'))
);
app.get('/admin', noStore, authPage, (req, res) => res.sendFile(path.join(config.viewsDir, 'panel.html')));
app.get('/admin/app.js', noStore, authPage, (req, res) => res.sendFile(path.join(config.viewsDir, 'admin.js')));

// Manejo central de errores (no se filtran detalles internos al cliente)
app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  if (req.path.startsWith('/api')) return res.status(500).json({ error: 'Error interno del servidor.' });
  res.status(500).send('Error interno del servidor.');
});

if (require.main === module) {
  db.initialize().then(() => {
    app.listen(config.port, () => {
      console.log(`Catálogo disponible en http://localhost:${config.port}`);
      console.log(`Panel de administración en http://localhost:${config.port}/admin`);
    });
  }).catch(error => {
    console.error('[STARTUP] No se pudo inicializar la aplicación:', error);
    process.exit(1);
  });
}

module.exports = app;
