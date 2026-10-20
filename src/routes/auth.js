'use strict';
const crypto = require('crypto');
const express = require('express');
const rateLimit = require('express-rate-limit');
const db = require('../db');
const { hashPassword, passwordIssues, verifyPassword } = require('../security');
const { COOKIE, cookieOptions, signToken, readUser } = require('../auth');
const config = require('../config');
const { sendPasswordReset } = require('../email');

const router = express.Router();

// Máximo 10 intentos fallidos cada 15 minutos por IP (frena la fuerza bruta).
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  skipSuccessfulRequests: true,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Demasiados intentos. Espere unos minutos e intente nuevamente.' }
});

const setupLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Demasiados intentos de configuración. Espere unos minutos e intente nuevamente.' }
});

const recoveryLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Demasiadas solicitudes. Espere unos minutos e intente nuevamente.' }
});

const resetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Demasiados intentos. Espere unos minutos e intente nuevamente.' }
});

const findUser = db.prepare('SELECT * FROM users WHERE email = ?');

router.get('/recovery-status', (req, res) => {
  res.json({ enabled: config.email.enabled });
});

router.post('/password-recovery', recoveryLimiter, (req, res) => {
  if (!config.email.enabled) {
    return res.status(503).json({ error: 'La recuperación por correo todavía no está configurada.' });
  }

  const email = String(req.body?.email ?? '').trim().toLowerCase();
  if (email.length > 254 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return res.status(400).json({ error: 'Ingrese un email válido.' });
  }

  const user = db.prepare('SELECT id, email FROM users WHERE email = ?').get(email);
  if (user) {
    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const resetUrl = new URL('/admin/reset-password', config.email.baseUrl);
    resetUrl.searchParams.set('token', token);
    db.transaction(() => {
      db.prepare('DELETE FROM password_reset_tokens WHERE user_id = ?').run(user.id);
      db.prepare(
        `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
         VALUES (?, ?, datetime('now', '+30 minutes'))`
      ).run(user.id, tokenHash);
    })();
    sendPasswordReset(user.email, resetUrl.toString()).catch(error => {
      console.error('[EMAIL] No se pudo enviar el enlace de recuperación:', error);
      db.prepare('DELETE FROM password_reset_tokens WHERE token_hash = ?').run(tokenHash);
    });
  }

  res.json({ message: 'Si existe una cuenta con ese email, recibirá un enlace para restablecer la contraseña.' });
});

router.post('/password-reset', resetLimiter, async (req, res) => {
  const token = String(req.body?.token ?? '');
  if (!/^[a-f0-9]{64}$/.test(token)) {
    return res.status(400).json({ error: 'El enlace no es válido o venció. Solicite uno nuevo.' });
  }
  const issues = passwordIssues(String(req.body?.password ?? ''));
  if (issues.length) return res.status(400).json({ error: issues.join(' ') });

  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const passwordHash = await hashPassword(String(req.body.password));
  const reset = db.transaction(() => {
    const record = db.prepare(
      `SELECT id, user_id FROM password_reset_tokens
       WHERE token_hash = ? AND expires_at > CURRENT_TIMESTAMP`
    ).get(tokenHash);
    if (!record) return false;
    db.prepare('UPDATE users SET password_hash = ?, token_version = token_version + 1 WHERE id = ?')
      .run(passwordHash, record.user_id);
    db.prepare('DELETE FROM password_reset_tokens WHERE user_id = ?').run(record.user_id);
    return true;
  })();

  if (!reset) return res.status(400).json({ error: 'El enlace no es válido o venció. Solicite uno nuevo.' });
  res.json({ ok: true });
});

router.get('/setup-status', (req, res) => {
  res.json({ setupRequired: !db.prepare('SELECT 1 FROM users LIMIT 1').get() });
});

router.post('/setup', setupLimiter, async (req, res) => {
  if (db.prepare('SELECT 1 FROM users LIMIT 1').get()) {
    return res.status(409).json({ error: 'La cuenta inicial ya fue creada. Inicie sesión.' });
  }
  const email = String(req.body?.email ?? '').trim().toLowerCase();
  const password = String(req.body?.password ?? '');
  if (email.length > 254 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return res.status(400).json({ error: 'Ingrese un email válido.' });
  }
  const issues = passwordIssues(password);
  if (issues.length) return res.status(400).json({ error: issues.join(' ') });

  const passwordHash = await hashPassword(password);
  const result = db.prepare(
    `INSERT INTO users (email, password_hash, role)
     SELECT ?, ?, 'admin'
     WHERE NOT EXISTS (SELECT 1 FROM users)`
  ).run(email, passwordHash);
  if (!result.changes) {
    return res.status(409).json({ error: 'La cuenta inicial ya fue creada. Inicie sesión.' });
  }

  const user = db.prepare('SELECT id, email, role, token_version FROM users WHERE id = ?').get(result.lastInsertRowid);
  res.cookie(COOKIE, signToken(user), cookieOptions());
  res.status(201).json({ user: { email: user.email, role: user.role } });
});

router.post('/login', loginLimiter, async (req, res) => {
  const email = String(req.body?.email ?? '').trim().toLowerCase().slice(0, 254);
  const password = String(req.body?.password ?? '');
  const user = findUser.get(email);

  // Se compara SIEMPRE contra un hash (real o de relleno): mismo tiempo exista o no el usuario.
  const ok = await verifyPassword(password, user?.password_hash);
  if (!user || !ok) return res.status(401).json({ error: 'Email o contraseña incorrectos.' });

  db.prepare('UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?').run(user.id);
  res.cookie(COOKIE, signToken(user), cookieOptions());
  res.json({ user: { email: user.email, role: user.role } });
});

router.post('/logout', (req, res) => {
  const user = readUser(req);
  // Subir token_version invalida el token aunque alguien lo hubiera copiado.
  if (user) db.prepare('UPDATE users SET token_version = token_version + 1 WHERE id = ?').run(user.id);
  res.clearCookie(COOKIE, { ...cookieOptions(), maxAge: undefined });
  res.json({ ok: true });
});

router.get('/me', (req, res) => {
  const user = readUser(req);
  if (!user) return res.status(401).json({ error: 'No autenticado.' });
  res.json({ user: { email: user.email, role: user.role } });
});

module.exports = router;
