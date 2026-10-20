'use strict';
const bcrypt = require('bcryptjs');

/* ---------------------------------------------------------------
   HASHEO DE CONTRASEÑAS (bcrypt)
   - Costo 12: ~250 ms por hash, lo que encarece los ataques de fuerza bruta.
   - bcrypt agrega una sal aleatoria y la guarda dentro del propio hash.
   - La contraseña en texto plano nunca se guarda ni se registra en logs.
   - bcrypt solo procesa los primeros 72 bytes: por eso se limita ese largo.
   --------------------------------------------------------------- */
const COST = 12;

// Hash falso para igualar el tiempo de respuesta cuando el usuario no existe
// (evita que un atacante descubra qué emails están registrados midiendo tiempos).
const DUMMY_HASH = bcrypt.hashSync('contraseña-de-relleno-no-valida', COST);

function passwordIssues(plain) {
  const issues = [];
  if (typeof plain !== 'string') return ['La contraseña es obligatoria.'];
  if (plain.length < 10) issues.push('Debe tener al menos 10 caracteres.');
  if (Buffer.byteLength(plain, 'utf8') > 72) issues.push('Debe tener como máximo 72 bytes.');
  if (!/[A-Za-z]/.test(plain) || !/\d/.test(plain)) issues.push('Debe incluir letras y números.');
  return issues;
}

/** REGISTRO: devuelve el hash que se guarda en users.password_hash */
async function hashPassword(plain) {
  const issues = passwordIssues(plain);
  if (issues.length) throw new Error(issues.join(' '));
  return bcrypt.hash(plain, COST);
}

/** VALIDACIÓN: compara la contraseña ingresada con el hash guardado */
async function verifyPassword(plain, storedHash) {
  const ok = await bcrypt.compare(String(plain || ''), storedHash || DUMMY_HASH);
  return Boolean(storedHash) && ok;
}

module.exports = { hashPassword, verifyPassword, passwordIssues };
