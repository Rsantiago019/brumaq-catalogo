'use strict';
const form = document.getElementById('form');
const errorBox = document.getElementById('error');
const submit = document.getElementById('submit');
const setupForm = document.getElementById('setupForm');
const setupError = document.getElementById('setupError');
const setupSubmit = document.getElementById('setupSubmit');
const forgotLink = document.getElementById('forgotLink');
const recoveryForm = document.getElementById('recoveryForm');
const recoveryError = document.getElementById('recoveryError');
const recoverySubmit = document.getElementById('recoverySubmit');

async function checkSetup() {
  try {
    const [setupResponse, recoveryResponse] = await Promise.all([
      fetch('/api/auth/setup-status', { credentials: 'same-origin' }),
      fetch('/api/auth/recovery-status', { credentials: 'same-origin' })
    ]);
    const [setup, recovery] = await Promise.all([
      setupResponse.json().catch(() => ({})),
      recoveryResponse.json().catch(() => ({}))
    ]);
    if (!setupResponse.ok) throw new Error(setup.error || 'No se pudo verificar la configuración.');
    if (setup.setupRequired) {
      form.hidden = true;
      setupForm.hidden = false;
      setupForm.elements.email.focus();
    }
    forgotLink.hidden = !recoveryResponse.ok || !recovery.enabled || setup.setupRequired;
  } catch (err) {
    errorBox.textContent = err.message;
    submit.disabled = true;
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

setupForm.addEventListener('submit', async e => {
  e.preventDefault();
  setupError.textContent = '';
  const email = setupForm.elements.email.value.trim();
  const password = setupForm.elements.password.value;
  if (password !== setupForm.elements.confirmation.value) {
    setupError.textContent = 'Las contraseñas no coinciden.';
    return;
  }
  setupSubmit.disabled = true;
  try {
    const response = await fetch('/api/auth/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch' },
      credentials: 'same-origin',
      body: JSON.stringify({ email, password })
    });
    const data = await response.json().catch(() => ({}));
    if (response.status === 409) {
      setupForm.hidden = true;
      form.hidden = false;
      forgotLink.hidden = true;
      errorBox.textContent = data.error || 'La cuenta inicial ya fue creada. Inicie sesión.';
      form.elements.email.focus();
      return;
    }
    if (!response.ok) throw new Error(data.error || 'No se pudo crear la cuenta.');
    location.href = '/admin';
  } catch (err) {
    setupError.textContent = err.message;
  } finally {
    setupSubmit.disabled = false;
  }
});

checkSetup();
