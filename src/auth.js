'use strict';
const jwt = require('jsonwebtoken');
const db = require('./db');
const config = require('./config');

const COOKIE = 'brumaq_session';
const TTL_HOURS = 8;

function cookieOptions() {
  return {
    httpOnly: true,                 // JavaScript del navegador no puede leer la cookie (mitiga XSS)
    sameSite: 'strict',             // el navegador no la envía desde otros sitios (mitiga CSRF)
    secure: config.isProd,          // solo por HTTPS en producción
    maxAge: TTL_HOURS * 3600 * 1000,
    path: '/'
  };
}

function signToken(user) {
  return jwt.sign({ sub: user.id, tv: user.token_version }, config.jwtSecret, {
    algorithm: 'HS256',
    expiresIn: `${TTL_HOURS}h`
  });
}

/** Devuelve el usuario de la sesión o null. Revalida contra la base en cada pedido. */
async function readUser(req) {
  const token = req.cookies && req.cookies[COOKIE];
  if (!token) return null;
  let payload;
  try {
    payload = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
  } catch {
    return null;
  }
  const result = await db.query('SELECT id, email, role, token_version FROM users WHERE id = $1', [payload.sub]);
  const user = result.rows[0];
  if (!user || user.token_version !== payload.tv) return null;
  return user;
}

/** Protege rutas de la API: responde 401 si no hay sesión válida. */
async function authRequired(req, res, next) {
  const user = await readUser(req);
  if (!user) return res.status(401).json({ error: 'Sesión no válida. Inicie sesión nuevamente.' });
  req.user = user;
  next();
}

/** Protege páginas HTML del panel: redirige al login. */
async function authPage(req, res, next) {
  const user = await readUser(req);
  if (!user) return res.redirect('/admin/login');
  req.user = user;
  next();
}

/** Defensa CSRF adicional a SameSite=Strict: exige un encabezado propio y un Origin coherente. */
function csrfGuard(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.get('X-Requested-With') !== 'fetch') {
    return res.status(403).json({ error: 'Solicitud no permitida.' });
  }
  const origin = req.get('Origin');
  if (origin) {
    try {
      if (new URL(origin).host !== req.get('Host')) throw new Error('origin');
    } catch {
      return res.status(403).json({ error: 'Origen no permitido.' });
    }
  }
  next();
}

module.exports = { COOKIE, cookieOptions, signToken, readUser, authRequired, authPage, csrfGuard };
