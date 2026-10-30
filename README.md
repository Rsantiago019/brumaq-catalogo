# Catálogo digital Brumaq

Catálogo público de maquinaria agrícola con panel de administración, gestión de productos e imágenes y recuperación de contraseña por correo. El proyecto está preparado para desplegarse en Vercel con Express Functions, Neon Postgres y Vercel Blob.

**Tecnologías:** Node.js 20+ · Express 5 · PostgreSQL · Vercel Blob · JWT en cookie `httpOnly` · bcrypt · Helmet.

## Arquitectura y persistencia

- Vercel sirve el catálogo estático y ejecuta el backend Express como Function para las rutas API y administrativas.
- Neon Postgres guarda cuentas, sesiones revocables, categorías, productos y referencias a imágenes.
- Los productos admiten un precio opcional en pesos argentinos; si se deja vacío, no se muestra en el catálogo.
- Vercel Blob guarda las imágenes públicas. La aplicación valida tipo MIME y firma del archivo antes de subirlo.
- Las funciones de Vercel no usan archivos locales como almacenamiento persistente.

## Configuración inicial

1. Instalar dependencias:

   ```bash
   npm install
   ```

2. En el proyecto de Vercel, agregar Neon desde **Storage / Marketplace** y conectar un almacén público de Vercel Blob al entorno Production. Confirmar que estén disponibles `DATABASE_URL` y `BLOB_STORE_ID`; Vercel Blob usa OIDC en producción y el SDK conserva `BLOB_READ_WRITE_TOKEN` como alternativa local.
3. Configurar en Vercel, para Production y Preview según corresponda:
   - `NODE_ENV=production`
   - `JWT_SECRET`: secreto aleatorio, exclusivo de producción, mínimo 32 caracteres.
   - `DATABASE_URL`: cadena de conexión de Neon (preferir la cadena pooled).
   - `BLOB_READ_WRITE_TOKEN`: token de escritura del almacén Blob.
   - `PUBLIC_BASE_URL`: dominio HTTPS público, sin barra final.
   - `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD` y `EMAIL_FROM` para recuperación por email.
   - Variables opcionales del negocio: `BUSINESS_NAME`, `WHATSAPP_NUMBER`, `WHATSAPP_MESSAGE`, `INSTAGRAM` y `MAP_QUERY`.
4. Conectar el repositorio y desplegarlo en Vercel. El archivo `vercel.json` enruta `/api/*` y las páginas dinámicas `/admin/*` al backend. Las páginas estáticas, incluido `/admin/reset-password.html`, se sirven desde `public/`.
5. Comprobar `https://<dominio>/api/health`. Debe responder `{"ok":true}`.
6. Abrir `/admin/login` y crear la primera cuenta. El formulario de configuración inicial deja de estar disponible una vez creada.

Generar un secreto localmente:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Para desarrollo local, copiar `.env.example` a `.env.local`, completar `DATABASE_URL`, un `BLOB_READ_WRITE_TOKEN` válido para el almacén conectado, `JWT_SECRET` y las demás variables. El archivo `.env.local` se carga automáticamente. `npm start` inicializa el esquema en Neon y sirve la aplicación en `http://localhost:3000`.

## Migrar la base SQLite existente

La migración copia las cuentas (incluidos los hashes de contraseña), categorías, productos y referencias de imágenes al Neon configurado. Las imágenes se suben a Blob. La migración **se detiene si la base de destino ya contiene cuentas, categorías o productos**.

1. Provisionar Neon y Blob, configurar `DATABASE_URL` y `BLOB_READ_WRITE_TOKEN` en `.env.local`.
2. Detener la aplicación antigua y realizar una copia de seguridad de `data/catalogo.db` y `uploads/`.
3. Mantener la base SQLite y las imágenes originales en las rutas locales por defecto, o indicar otras rutas con `SOURCE_DB_PATH` y `SOURCE_UPLOAD_DIR`.
4. Ejecutar desde la raíz:

   ```bash
   npm run migrate:vercel
   ```

5. Revisar el resumen de migración y probar el login, los productos e imágenes en una vista previa antes de cambiar el dominio.
6. Solicitar un enlace nuevo de recuperación después de la migración. No compartir enlaces que contengan tokens.

No borrar la base ni los archivos originales hasta verificar la migración y conservar una copia de seguridad restaurable.

## Primer administrador y operaciones

También se puede crear el primer administrador desde `/admin/login`. Para crear cuentas adicionales se usa el panel (**Cuentas**), accesible solo a administradores.

Los scripts administrativos se conectan a `DATABASE_URL`:

```bash
npm run create-admin
npm run reset-password
npm run seed
npm run seed -- --reset
```

Los comandos de seed son solo para demostración: agregan productos de ejemplo con una imagen de placeholder.

## Recuperación de contraseña

El formulario está publicado en `/admin/reset-password.html`. Para que el flujo funcione se necesita configurar SMTP y desplegar el backend y la base Neon. Los tokens son aleatorios, se almacena su hash, vencen en 30 minutos, se usan una sola vez y al completar el cambio se revocan las sesiones anteriores.

## Prueba de integración

`npm run test:smoke` comprueba contra los servicios configurados el login de administrador, alta y acceso de una cuenta, recuperación completa de contraseña con envío SMTP, y alta/consulta/baja de un producto con imagen en Vercel Blob. Al terminar, elimina la cuenta, categoría, producto e imagen temporales.

La prueba **escribe datos y envía un correo real** al buzón de prueba. Use un buzón dedicado que no exista todavía como cuenta y credenciales de administrador válidas. Configure en `.env.local`:

```text
SMOKE_TEST_ADMIN_EMAIL=admin@ejemplo.com
SMOKE_TEST_ADMIN_PASSWORD=contraseña-del-administrador
SMOKE_TEST_EMAIL=buzon-de-prueba@ejemplo.com
SMOKE_TEST_ALLOW_WRITES=YES
```

La configuración habitual de `DATABASE_URL`, `JWT_SECRET`, `BLOB_READ_WRITE_TOKEN`, SMTP y `PUBLIC_BASE_URL` también debe estar disponible. La prueba se ejecuta contra esos servicios reales; no la apunte a una base o almacén que no pueda recibir datos temporales.

Para autorizar explícitamente la escritura y confirmar que los servicios configurados podrían ser de producción:

```bash
npm run test:smoke -- --confirm-writes --allow-production-writes
```

Además, defina `SMOKE_TEST_ALLOW_WRITES=YES`. Ambas confirmaciones son obligatorias en cada ejecución porque el script no puede determinar si las credenciales apuntan a producción. La limpieza se intenta incluso si falla una verificación; revise la salida si se informa un error de limpieza.

## Imágenes

El panel acepta JPG, PNG y WebP de hasta **4 MB por imagen**, con un máximo de ocho imágenes por producto. Cada imagen se envía por separado para mantenerse bajo el límite de payload de las Functions de Vercel y se almacena en Blob. El panel valida firmas reales del archivo antes de subirlo.

El precio del producto es opcional y se ingresa en pesos argentinos. Dejar el campo vacío oculta el precio en la ficha pública; se aceptan hasta dos decimales.

## API

**Pública**

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/health` | Comprobar conexión con la base |
| GET | `/api/config` | Nombre, WhatsApp, Instagram y mapa |
| GET | `/api/categories` | Categorías con productos activos |
| GET | `/api/products?category=<slug>` | Catálogo público |
| GET | `/api/products/:slug` | Detalle de un producto |

**Autenticación**

`GET /api/auth/setup-status` · `POST /api/auth/setup` · `POST /api/auth/login` · `POST /api/auth/logout` · `GET /api/auth/me` · `GET /api/auth/recovery-status` · `POST /api/auth/password-recovery` · `POST /api/auth/password-reset`

**Administración** (requiere sesión; las escrituras exigen `X-Requested-With: fetch`)

| Método | Ruta | Descripción |
|---|---|---|
| GET / POST | `/api/admin/products` | Listar / crear producto |
| GET / PUT / DELETE | `/api/admin/products/:id` | Ver / actualizar / eliminar producto |
| GET / POST | `/api/admin/categories` | Listar / crear categoría |
| PUT / DELETE | `/api/admin/categories/:id` | Renombrar / eliminar categoría |
| GET / POST | `/api/admin/users` | Listar / crear cuentas (solo administrador) |
| DELETE | `/api/admin/users/:id` | Eliminar una cuenta; no permite eliminar la propia ni la última cuenta de administrador |
| PUT | `/api/admin/password` | Cambiar contraseña propia |
| POST / DELETE | `/api/admin/uploads` | Subir / limpiar imágenes temporales |

## Seguridad y operación

- Contraseñas con bcrypt (costo 12), mínimo 10 caracteres, letras y números, máximo 72 bytes.
- Cookie de sesión `httpOnly`, `SameSite=Strict`, `Secure` en producción y vencimiento a las 8 horas.
- CSRF: encabezado propio y verificación de `Origin` en solicitudes de escritura.
- Consultas SQL parametrizadas, límites de frecuencia en login y recuperación, y tokens de recuperación de un solo uso.
- Los productos inactivos no aparecen en rutas públicas.
- Mantener una copia de seguridad externa de Neon y Blob. Probar restauración antes de depender de las copias.
- Revisar logs y errores de las Functions tras cada despliegue. Los limitadores de frecuencia actuales usan memoria por instancia; para protección compartida entre instancias, configurar un almacenamiento distribuido antes de una exposición de alto tráfico.

Para la lista de pasos de publicación y sus verificaciones, consultar [DEPLOYMENT-CHECKLIST.md](./DEPLOYMENT-CHECKLIST.md).
