'use strict';
const nodemailer = require('nodemailer');
const config = require('./config');

const transport = config.email.enabled
  ? nodemailer.createTransport({
      host: config.email.host,
      port: config.email.port,
      secure: config.email.secure,
      requireTLS: !config.email.secure,
      tls: { minVersion: 'TLSv1.2' },
      auth: config.email.user
        ? { user: config.email.user, pass: config.email.password }
        : undefined
    })
  : null;

async function sendPasswordReset(email, resetUrl) {
  if (!transport) throw new Error('El servicio de correo no está configurado.');
  await transport.sendMail({
    from: config.email.from,
    to: email,
    subject: 'Restablecer contraseña de administrador',
    text:
      `Recibimos una solicitud para restablecer la contraseña de tu cuenta.\n\n` +
      `Abrí este enlace antes de que venza (30 minutos):\n${resetUrl}\n\n` +
      `Si no solicitaste el cambio, podés ignorar este mensaje.`,
    html:
      `<p>Recibimos una solicitud para restablecer la contraseña de tu cuenta.</p>` +
      `<p><a href="${resetUrl}">Restablecer contraseña</a></p>` +
      `<p>El enlace vence en 30 minutos. Si no solicitaste el cambio, podés ignorar este mensaje.</p>`
  });
}

const oneLine = value => String(value).replace(/[\r\n]+/g, ' ').trim();

async function sendInquiry({ name, contact, replyTo, product, message }) {
  if (!transport || !config.email.contactTo) throw new Error('El servicio de correo no está configurado.');
  await transport.sendMail({
    from: config.email.from,
    to: config.email.contactTo,
    replyTo: replyTo || undefined,
    subject: `Consulta web: ${oneLine(product || 'consulta general')}`.slice(0, 150),
    text: `Nombre: ${oneLine(name)}\nContacto: ${oneLine(contact)}\nProducto: ${oneLine(product || '-')}\n\n${message}`
  });
}

module.exports = { sendPasswordReset, sendInquiry };
