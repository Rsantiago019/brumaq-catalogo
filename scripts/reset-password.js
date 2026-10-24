'use strict';
/* Cambia la contraseña de un usuario existente (por ejemplo, si la olvidó).
 *   npm run reset-password -- --email admin@empresa.com --password "NuevaClave-2025"
 * Además cierra todas sus sesiones abiertas (sube token_version).
 */
const db = require('../src/db');
const { hashPassword, passwordIssues } = require('../src/security');
const readline = require('readline');
const { close } = db;

const arg = n => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : undefined; };
function ask(question, { hidden = false } = {}) {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl.stdoutMuted = false;
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
  const email = (arg('email') || (await ask('Email de la cuenta: '))).trim().toLowerCase();
  if (email.length > 254 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('Email inválido.');
  let password = arg('password');
  if (!password) {
    password = await ask('Nueva contraseña (mín. 10, letras y números): ', { hidden: true });
    const confirmation = await ask('Repita la nueva contraseña: ', { hidden: true });
    if (password !== confirmation) throw new Error('Las contraseñas no coinciden.');
  }
  const issues = passwordIssues(password);
  if (issues.length) throw new Error(issues.join(' '));
  const hash = await hashPassword(password);
  const result = await db.query(
    'UPDATE users SET password_hash = $1, token_version = token_version + 1 WHERE LOWER(email) = $2',
    [hash, email]
  );
  if (!result.rowCount) throw new Error('No existe un usuario con ese email.');
  console.log(`Contraseña actualizada para ${email}. Las sesiones anteriores fueron cerradas.`);
})().catch(e => { console.error(`[ERROR] ${e.message}`); process.exitCode = 1; }).finally(close);
