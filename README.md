# Catálogo digital de maquinaria agrícola

Plataforma con **catálogo público**, **panel de administración** (CRUD de productos con imágenes) y
**botón de WhatsApp** por producto. **No muestra precios** (el esquema ni siquiera tiene esa columna).

**Stack:** Node.js 18+ · Express 5 · SQLite (`better-sqlite3`) · bcrypt (`bcryptjs`) · JWT en cookie httpOnly · Multer · Helmet.
Frontend sin frameworks (HTML + CSS + JS, GSAP opcional para animar las tarjetas).

---

## 1. Puesta en marcha

```bash
npm install
cp .env.example .env            # y complete JWT_SECRET, WHATSAPP_NUMBER, etc.
npm run create-admin            # registra al administrador (la clave se guarda hasheada)
npm run seed                    # (opcional) carga productos de ejemplo
npm start                       # http://localhost:3000   ·   panel: /admin
```

Generar una clave de sesión: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`

La primera cuenta también puede crearse desde `/admin/login` si todavía no hay usuarios. Una vez creada, el registro público queda cerrado. Desde **Cuentas** en el panel, un administrador puede crear otras cuentas y cualquier usuario puede cambiar su propia contraseña.

Para habilitar **¿Olvidó su contraseña?**, configure `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `EMAIL_FROM` y `PUBLIC_BASE_URL` en `.env` (hay ejemplos en `.env.example`) y reinicie el servidor. `PUBLIC_BASE_URL` debe ser la URL pública de la aplicación, sin una barra final; en producción, use HTTPS. El enlace es de un solo uso, vence en 30 minutos, y el cambio cierra las sesiones existentes. Si el correo no está configurado, puede restablecerla desde la consola con `npm run reset-password -- --email administrador@empresa.com`.

Otros comandos: `npm run dev` (reinicio automático) · `npm run seed -- --reset`.

---

## 2. Estructura

```
server.js                 Arranque, seguridad (Helmet/CSP), rutas y páginas protegidas
src/config.js             Variables de entorno
src/db.js                 Conexión SQLite + esquema
src/security.js           Hasheo y validación de contraseñas (bcrypt)
src/auth.js               Sesión (JWT en cookie), middleware de protección y CSRF
src/upload.js             Subida de imágenes con validación de tipo y firma
src/routes/public.js      API pública de solo lectura (catálogo)
src/routes/auth.js        Login / logout / sesión actual
src/routes/admin.js       CRUD de productos y de tipos (protegido)
scripts/                  create-admin, reset-password, seed
public/                   Catálogo público (index.html, css, js, img)
views/                    Panel de administración (solo se entrega con sesión válida)
```

---

## 3. Base de datos

| Tabla | Campos principales |
|---|---|
| **users** | `id`, `email` (único), `password_hash` (bcrypt), `role` (admin/editor), `token_version`, `last_login_at`, `created_at` |
| **categories** *(tipos de producto)* | `id`, `name` (único), `slug` (único), `position` |
| **products** | `id`, `name`, `slug` (único), `category_id` → categories, `description`, `specs` (JSON), `status` (`active`/`inactive`), `created_at`, `updated_at` |
| **product_images** | `id`, `product_id` → products (borrado en cascada), `filename`, `position` |

`specs` guarda una lista de pares, por ejemplo: `[{"label":"Potencia","value":"110 HP"},{"label":"Tracción","value":"4x4"}]`.
Los tipos de producto (Tractores, Trilladoras, Cosechadoras…) se administran desde el panel y alimentan los filtros del catálogo.

---

## 4. API

**Pública** (solo productos `active`)

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/config` | Nombre, WhatsApp, plantilla del mensaje |
| GET | `/api/categories` | Tipos con al menos un producto activo y su cantidad |
| GET | `/api/products?category=<slug>` | Listado, con filtro opcional por tipo |
| GET | `/api/products/:slug` | Detalle |

**Sesión:** `POST /api/auth/login` · `POST /api/auth/logout` · `GET /api/auth/me` · `POST /api/auth/password-recovery` · `POST /api/auth/password-reset` · creación inicial limitada a instalación sin usuarios: `GET /api/auth/setup-status`, `POST /api/auth/setup`

**Administración** (requiere sesión; las escrituras exigen el encabezado `X-Requested-With: fetch`)

| Método | Ruta | Descripción |
|---|---|---|
| GET / POST | `/api/admin/products` | Listar todos / crear (`multipart/form-data`, campo `images`) |
| GET / PUT / DELETE | `/api/admin/products/:id` | Ver / actualizar (solo los campos enviados; `remove_images=[ids]`) / borrar |
| GET / POST | `/api/admin/categories` | Listar / crear tipo |
| PUT / DELETE | `/api/admin/categories/:id` | Renombrar / borrar (se bloquea si tiene productos) |
| POST | `/api/admin/users` | Crear otra cuenta de administrador (solo administrador) |
| PUT | `/api/admin/password` | Cambiar la contraseña propia; revoca las sesiones activas |

---

## 5. Seguridad implementada

- **Contraseñas con bcrypt (costo 12)**, con sal automática. Nunca se guardan ni se registran en texto plano. Mínimo 10 caracteres, letras y números, máximo 72 bytes (límite de bcrypt).
- **Registro restringido:** la primera cuenta puede crearse desde el login solo mientras no exista ningún usuario; luego únicamente un administrador autenticado puede crear cuentas. La recuperación por correo usa tokens aleatorios de un solo uso, guarda solo el hash, vence a los 30 minutos, responde sin revelar si existe el email y revoca las sesiones. También queda disponible el restablecimiento por consola como alternativa.
- **Login resistente a enumeración:** mensaje genérico y tiempo de respuesta igual exista o no el email. **Límite de 10 intentos fallidos cada 15 min por IP.**
- **Sesión** en cookie `httpOnly` + `SameSite=Strict` (+ `Secure` en producción), expira a las 8 h. Cada pedido revalida al usuario en la base; **cerrar sesión invalida el token** (`token_version`).
- **CSRF:** `SameSite=Strict` + encabezado propio obligatorio + verificación de `Origin`.
- **Subida de archivos:** solo JPG/PNG/WebP, máx. 5 MB y 8 por producto, nombre aleatorio, verificación de la **firma real** del archivo, y `/uploads` se sirve con CSP restrictiva y `nosniff`.
- **SQL parametrizado** en todas las consultas. **XSS:** el frontend inserta datos con `textContent`; además hay CSP estricta (sin scripts inline).
- Los productos **inactivos** no se exponen en ninguna ruta pública.

---

## 6. Botón de WhatsApp

El mensaje se arma con una plantilla del `.env`:

```
WHATSAPP_MESSAGE=Hola, estoy interesado en obtener más información sobre {producto} ({categoria}) que vi en su web.
```

Variables: `{producto}`, `{categoria}` y `{url}` (enlace directo a la ficha). El código está en `public/js/catalog.js` → `waLink(product)`.
`WHATSAPP_NUMBER` va en formato internacional sin `+` ni espacios (ej. `5492945123456`).

---

## 7. Producción

1. Servir detrás de **HTTPS** (Nginx/Caddy/Cloudflare) y poner `NODE_ENV=production` y `TRUST_PROXY=1`.
2. Mantener un `JWT_SECRET` largo y secreto; cambiarlo cierra todas las sesiones.
3. Hacer **copias de seguridad** de `data/` (base) y `uploads/` (imágenes).
4. Mantener la app con un gestor de procesos (pm2, systemd) y actualizar dependencias (`npm audit`).

### Cambiar de base de datos
Las consultas están aisladas en `src/db.js` y `src/routes/*`. Para **MySQL/PostgreSQL** se reemplaza `better-sqlite3` por `mysql2`/`pg` (las consultas son SQL estándar).
Para **MongoDB** (Mongoose): `User`, `Category`, `Product` con `images: [String]` y `specs: [{label, value}]` incrustados, y los mismos controladores.
