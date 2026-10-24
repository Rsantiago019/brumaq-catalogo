'use strict';
/* REGISTRO de un administrador (no existe registro público por seguridad).
 *
 *   npm run create-admin
 *   npm run create-admin -- --email admin@empresa.com --password "MiClave-Segura-2025"
 *
 * Reglas de la contraseña: mínimo 10 caracteres, letras y números.
 * Solo se guarda el hash bcrypt; la contraseña nunca queda registrada.
 */
const readline = require('readline');
const db = require('../src/db');
const { hashPassword, passwordIssues } = require('../src/security');

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

function ask(question, { hidden = false } = {}) {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl.stdoutMuted = false;
    // Con "hidden" no se muestran en pantalla los caracteres que se escriben.
    rl._writeToOutput = str => {
      if (!rl.stdoutMuted) rl.output.write(str);
    };
    rl.question(question, answer => {
      rl.close();
      if (hidden) process.stdout.write('\n');
      resolve(answer);
    });
    rl.stdoutMuted = hidden;
  });
}

(async () => {
  await db.initialize();
  const email = (arg('email') || (await ask('Email del administrador: '))).trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('Email inválido.');

  const password = arg('password') || (await ask('Contraseña (mín. 10, letras y números): ', { hidden: true }));
  const issues = passwordIssues(password);
  if (issues.length) throw new Error(issues.join(' '));

  const hash = await hashPassword(password); // bcrypt, costo 12
  try {
    await db.query('INSERT INTO users (email, password_hash, role) VALUES ($1, $2, $3)', [email, hash, 'admin']);
    console.log(`\nAdministrador creado: ${email}`);
  } catch (e) {
    if (e.code === '23505') throw new Error('Ya existe un usuario con ese email.');
    throw e;
  }
})().catch(e => {
  console.error(`\n[ERROR] ${e.message}`);
  process.exitCode = 1;
}).finally(() => db.close());
