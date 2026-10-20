'use strict';
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const path = require('path');
const config = require('./src/config');
config.assertSecure();

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
        imgSrc: ["'self'", 'data:', 'blob:'], // blob: permite la vista previa local de las imágenes antes de subirlas
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

// Archivos subidos: se sirven aislados (sin scripts) y sin listado de carpeta.
app.use(
  '/uploads',
  (req, res, next) => {
    res.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
    next();
  },
  express.static(config.uploadDir, { maxAge: '7d', index: false, dotfiles: 'deny' })
);

app.use(express.static(config.publicDir, { maxAge: config.isProd ? '1h' : 0 }));
app.use(express.static('public'));
// API
app.use('/api', csrfGuard);
app.use('/api/auth', authRoutes);
app.use('/api/admin', authRequired, adminRoutes);
app.use('/api', publicRoutes);
app.use('/api', (req, res) => res.status(404).json({ error: 'No encontrado.' }));

// Páginas del panel (el HTML y el JS del panel solo se entregan con sesión válida)
const noStore = (req, res, next) => (res.set('Cache-Control', 'no-store'), next());
app.get('/admin/login', noStore, (req, res) =>
  readUser(req) ? res.redirect('/admin') : res.sendFile(path.join(config.viewsDir, 'login.html'))
);
app.get('/admin/reset-password', noStore, (req, res) =>
  readUser(req) ? res.redirect('/admin') : res.sendFile(path.join(config.viewsDir, 'reset-password.html'))
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

app.listen(config.port, () => {
  console.log(`Catálogo disponible en http://localhost:${config.port}`);
  console.log(`Panel de administración en http://localhost:${config.port}/admin`);
});
