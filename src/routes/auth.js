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

function limiter(limit, message, skipSuccessfulRequests = false) {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    limit,
    skipSuccessfulRequests,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: message }
  });
}

const loginLimiter = limiter(10, 'Demasiados intentos. Espere unos minutos e intente nuevamente.', true);
const recoveryLimiter = limiter(5, 'Demasiadas solicitudes. Espere unos minutos e intente nuevamente.');
const resetLimiter = limiter(10, 'Demasiados intentos. Espere unos minutos e intente nuevamente.');

router.get('/recovery-status', (req, res) => {
  res.json({ enabled: config.email.enabled });
});

router.post('/password-recovery', recoveryLimiter, async (req, res) => {
  if (!config.email.enabled) {
    return res.status(503).json({ error: 'La recuperación por correo todavía no está configurada.' });
  }

  const email = String(req.body?.email ?? '').trim().toLowerCase();
  if (email.length > 254 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return res.status(400).json({ error: 'Ingrese un email válido.' });
  }

  const { rows } = await db.query('SELECT id, email FROM users WHERE LOWER(email) = $1', [email]);
  if (rows[0]) {
    const user = rows[0];
    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const resetUrl = new URL('/admin/reset-password.html', config.email.baseUrl);
    resetUrl.searchParams.set('token', token);
    await db.transaction(async client => {
      await client.query('DELETE FROM password_reset_tokens WHERE user_id = $1', [user.id]);
      await client.query(
        `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
         VALUES ($1, $2, CURRENT_TIMESTAMP + INTERVAL '30 minutes')`,
        [user.id, tokenHash]
      );
    });
    try {
      await sendPasswordReset(user.email, resetUrl.toString());
    } catch (error) {
      console.error('[EMAIL] No se pudo enviar el enlace de recuperación:', error);
      await db.query('DELETE FROM password_reset_tokens WHERE token_hash = $1', [tokenHash]);
    }
  }

  res.json({ message: 'Si existe una cuenta con ese email, recibirá un enlace para restablecer la contraseña.' });
});

router.post('/password-reset', resetLimiter, async (req, res) => {
  const token = String(req.body?.token ?? '');
  if (!/^[a-f0-9]{64}$/.test(token)) {
    return res.status(400).json({ error: 'El enlace no es válido o venció. Solicite uno nuevo.' });
  }
  const password = String(req.body?.password ?? '');
  const issues = passwordIssues(password);
  if (issues.length) return res.status(400).json({ error: issues.join(' ') });

  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const passwordHash = await hashPassword(password);
  const reset = await db.transaction(async client => {
    const { rows } = await client.query(
      `SELECT id, user_id FROM password_reset_tokens
       WHERE token_hash = $1 AND expires_at > CURRENT_TIMESTAMP FOR UPDATE`,
      [tokenHash]
    );
    const record = rows[0];
    if (!record) return false;
    await client.query(
      'UPDATE users SET password_hash = $1, token_version = token_version + 1 WHERE id = $2',
      [passwordHash, record.user_id]
    );
    await client.query('DELETE FROM password_reset_tokens WHERE user_id = $1', [record.user_id]);
    return true;
  });

  if (!reset) return res.status(400).json({ error: 'El enlace no es válido o venció. Solicite uno nuevo.' });
  res.json({ ok: true });
});

router.post('/login', loginLimiter, async (req, res) => {
  const email = String(req.body?.email ?? '').trim().toLowerCase().slice(0, 254);
  const password = String(req.body?.password ?? '');
  const result = await db.query('SELECT * FROM users WHERE LOWER(email) = $1', [email]);
  const user = result.rows[0];
  const ok = await verifyPassword(password, user?.password_hash);
  if (!user || !ok) return res.status(401).json({ error: 'Email o contraseña incorrectos.' });

  await db.query('UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = $1', [user.id]);
  res.cookie(COOKIE, signToken(user), cookieOptions());
  res.json({ user: { email: user.email, role: user.role } });
});

router.post('/logout', async (req, res) => {
  const user = await readUser(req);
  if (user) await db.query('UPDATE users SET token_version = token_version + 1 WHERE id = $1', [user.id]);
  res.clearCookie(COOKIE, { ...cookieOptions(), maxAge: undefined });
  res.json({ ok: true });
});

router.get('/me', async (req, res) => {
  const user = await readUser(req);
  if (!user) return res.status(401).json({ error: 'No autenticado.' });
  res.json({ user: { email: user.email, role: user.role } });
});

module.exports = router;
