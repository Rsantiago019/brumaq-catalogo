'use strict';
const path = require('path');
const root = path.join(__dirname, '..');
require('dotenv').config({ path: path.join(root, '.env.local'), quiet: true });
require('dotenv').config({ path: path.join(root, '.env'), quiet: true });

const env = process.env;
const abs = (p, fallback) => path.resolve(root, p || fallback);

module.exports = {
  root,
  isProd: env.NODE_ENV === 'production',
  port: Number(env.PORT) || 3000,
  trustProxy: env.TRUST_PROXY === '1' || env.VERCEL === '1',
  jwtSecret: env.JWT_SECRET || '',
  databaseUrl: env.DATABASE_URL || '',
  blobToken: env.BLOB_READ_WRITE_TOKEN || '',
  sourceDbPath: abs(env.SOURCE_DB_PATH, './data/catalogo.db'),
  sourceUploadDir: abs(env.SOURCE_UPLOAD_DIR, './uploads'),
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
    maxImageBytes: 4 * 1024 * 1024
  },
  // Falla al arrancar si la clave de sesión es débil: nunca debe usarse un secreto por defecto.
  assertSecure() {
    if (!this.jwtSecret || this.jwtSecret.length < 32) {
      console.error(
        '\n[ERROR] Falta JWT_SECRET en el entorno (mínimo 32 caracteres).\n' +
          'Genere una con: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"\n'
      );
      process.exit(1);
    }
  }
};
