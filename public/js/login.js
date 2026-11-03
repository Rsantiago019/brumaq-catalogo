'use strict';
const form = document.getElementById('form');
const errorBox = document.getElementById('error');
const submit = document.getElementById('submit');
const forgotLink = document.getElementById('forgotLink');
const recoveryForm = document.getElementById('recoveryForm');
const recoveryError = document.getElementById('recoveryError');
const recoverySubmit = document.getElementById('recoverySubmit');

async function checkRecovery() {
  try {
    const response = await fetch('/api/auth/recovery-status', { credentials: 'same-origin' });
    const recovery = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(recovery.error || 'No se pudo verificar la recuperación por correo.');
    forgotLink.hidden = !recovery.enabled;
  } catch (error) {
    forgotLink.hidden = true;
    console.error('[LOGIN] No se pudo verificar la recuperación por correo:', error);
  }
}

forgotLink.addEventListener('click', e => {
  e.preventDefault();
  recoveryError.textContent = '';
  recoveryForm.elements.email.value = form.elements.email.value.trim();
  form.hidden = true;
  forgotLink.hidden = true;
  recoveryForm.hidden = false;
  recoveryForm.elements.email.focus();
});

document.getElementById('recoveryCancel').addEventListener('click', () => {
  recoveryForm.hidden = true;
  form.hidden = false;
  forgotLink.hidden = false;
  form.elements.email.focus();
});

recoveryForm.addEventListener('submit', async e => {
  e.preventDefault();
  recoveryError.textContent = '';
  recoverySubmit.disabled = true;
  try {
    const response = await fetch('/api/auth/password-recovery', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch' },
      credentials: 'same-origin',
      body: JSON.stringify({ email: recoveryForm.elements.email.value.trim() })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'No se pudo solicitar el enlace.');
    recoveryError.className = 'hint';
    recoveryError.textContent = data.message;
    recoveryForm.elements.email.value = '';
  } catch (err) {
    recoveryError.className = 'error';
    recoveryError.textContent = err.message;
  } finally {
    recoverySubmit.disabled = false;
  }
});

form.addEventListener('submit', async e => {
  e.preventDefault();
  errorBox.textContent = '';
  const email = form.email.value.trim();
  const password = form.password.value;
  if (!email || !password) {
    errorBox.textContent = 'Ingrese su email y contraseña.';
    return;
  }
  submit.disabled = true;
  try {
    const r = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch' },
      credentials: 'same-origin',
      body: JSON.stringify({ email, password })
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || 'No se pudo iniciar sesión.');
    location.href = '/admin';
  } catch (err) {
    errorBox.textContent = err.message;
    form.password.value = '';
    form.password.focus();
  } finally {
    submit.disabled = false;
  }
});

checkRecovery();
