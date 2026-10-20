'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });

const root = path.join(__dirname, '..');
const env = process.env;
const abs = (p, fallback) => path.resolve(root, p || fallback);

module.exports = {
  root,
  isProd: env.NODE_ENV === 'production',
  port: Number(env.PORT) || 3000,
  trustProxy: env.TRUST_PROXY === '1',
  jwtSecret: env.JWT_SECRET || '',
  dbPath: abs(env.DB_PATH, './data/catalogo.db'),
  uploadDir: abs(env.UPLOAD_DIR, './uploads'),
  email: {
    host: env.SMTP_HOST || '',
    port: Number(env.SMTP_PORT) || 0,
    secure: env.SMTP_SECURE === 'true' || Number(env.SMTP_PORT) === 465,
    user: env.SMTP_USER || '',
    password: env.SMTP_PASSWORD || '',
    from: env.EMAIL_FROM || '',
    baseUrl: (env.PUBLIC_BASE_URL || '').replace(/\/+$/, ''),
    get enabled() {
      if (!this.host || this.port < 1 || this.port > 65535 || !this.from || !this.baseUrl) return false;
      if (Boolean(this.user) !== Boolean(this.password)) return false;
      try {
        const url = new URL(this.baseUrl);
        return (
          ['http:', 'https:'].includes(url.protocol) &&
          !url.username &&
          !url.password &&
          !url.search &&
          !url.hash &&
          (!module.exports.isProd || url.protocol === 'https:')
        );
      } catch {
        return false;
      }
    }
  },
  publicDir: path.join(root, 'public'),
  viewsDir: path.join(root, 'views'),
  business: {
    name: env.BUSINESS_NAME || 'Brumaq',
    whatsappNumber: (env.WHATSAPP_NUMBER || '').replace(/\D/g, ''),
    instagram: env.INSTAGRAM || '',
    mapQuery: env.MAP_QUERY || 'Argentina',
    whatsappMessage:
      env.WHATSAPP_MESSAGE ||
      'Hola, estoy interesado en obtener más información sobre {producto} ({categoria}) que vi en su web.'
  },
  limits: {
    maxImagesPerProduct: 8,
    maxImageBytes: 5 * 1024 * 1024
  },
  // Falla al arrancar si la clave de sesión es débil: nunca debe usarse un secreto por defecto.
  assertSecure() {
    if (!this.jwtSecret || this.jwtSecret.length < 32) {
      console.error(
        '\n[ERROR] Falta JWT_SECRET en el archivo .env (mínimo 32 caracteres).\n' +
          'Genere una con: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"\n'
      );
      process.exit(1);
    }
  }
};
