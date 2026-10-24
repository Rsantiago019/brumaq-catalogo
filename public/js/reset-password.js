'use strict';
const form = document.getElementById('resetForm');
const errorBox = document.getElementById('resetError');
const submit = document.getElementById('resetSubmit');
const token = new URLSearchParams(location.search).get('token') || '';

form.addEventListener('submit', async event => {
  event.preventDefault();
  errorBox.className = 'error';
  errorBox.textContent = '';
  const password = form.elements.password.value;
  if (password !== form.elements.confirmation.value) {
    errorBox.textContent = 'Las contraseñas no coinciden.';
    return;
  }
  submit.disabled = true;
  try {
    const response = await fetch('/api/auth/password-reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch' },
      credentials: 'same-origin',
      body: JSON.stringify({ token, password })
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(
        data?.error ||
          (response.status === 404
            ? 'El servicio de restablecimiento no está disponible en este sitio.'
            : 'No se pudo restablecer la contraseña.')
      );
    }
    if (!data?.ok) throw new Error('El servidor devolvió una respuesta inválida.');
    form.hidden = true;
    errorBox.className = 'hint';
    errorBox.textContent = 'Contraseña actualizada. Ya puede ingresar con su nueva contraseña.';
  } catch (error) {
    errorBox.textContent = error.message;
  } finally {
    submit.disabled = false;
  }
});
