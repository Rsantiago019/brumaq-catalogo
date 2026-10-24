# Checklist para publicar Brumaq en Internet

Guía para desplegar y validar el catálogo, el panel y la recuperación de contraseñas.

> **Arquitectura elegida:** Vercel Functions + Neon Postgres + Vercel Blob. El código del repositorio ya está adaptado a esta arquitectura, incluye la migración desde SQLite y el enrutamiento de Vercel. El sitio de producción no cambiará hasta configurar los servicios, publicar los cambios y verificar el despliegue.

## 1. Servicios e infraestructura

- [x] Preparar la aplicación para Vercel Functions con Express y Node.js.
- [x] Preparar Neon Postgres para cuentas, categorías, productos e imágenes registradas.
- [x] Preparar Vercel Blob para las imágenes persistentes.
- [x] Añadir rutas de Vercel para `/api/*` y las páginas dinámicas `/admin/*`.
- [ ] En el proyecto correcto de Vercel, provisionar una base Neon desde Marketplace y un almacén Vercel Blob.
- [ ] Verificar que no haya una base de producción existente que deba conservarse antes de inicializar el esquema.

## 2. Variables y dominio

- [x] Documentar las variables y retirar secretos de `.env.example`.
- [ ] Configurar `DATABASE_URL` con la conexión pooled de Neon.
- [ ] Configurar `BLOB_READ_WRITE_TOKEN` con el almacén Blob correcto.
- [ ] Configurar un `JWT_SECRET` nuevo, aleatorio y exclusivo de producción (mínimo 32 caracteres).
- [ ] Definir `NODE_ENV=production`.
- [ ] Configurar `PUBLIC_BASE_URL` con el dominio HTTPS definitivo, sin barra final.
- [ ] Configurar el dominio y comprobar que HTTPS esté activo.
- [ ] Configurar `TRUST_PROXY=1` si corresponde al proxy de la plataforma.
- [ ] Configurar las variables SMTP para recuperación de contraseña: `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD` y `EMAIL_FROM`.
- [ ] Verificar las variables opcionales de negocio: nombre, WhatsApp, Instagram y mapa.
- [x] Mantener `.env`, la base local y los uploads fuera del repositorio y del paquete publicado con `.vercelignore`.

## 3. Migrar datos y archivos existentes

- [x] Añadir `npm run migrate:vercel` para copiar cuentas, categorías, productos e imágenes desde SQLite a Neon y Blob.
- [x] La migración se niega a escribir si la base de destino ya contiene cuentas, categorías o productos.
- [ ] Hacer copia de seguridad de `data/catalogo.db` y `uploads/`.
- [ ] Detener los cambios en el catálogo antiguo mientras se toma la copia y se ejecuta la migración.
- [ ] Ejecutar `npm run migrate:vercel` con `DATABASE_URL` y `BLOB_READ_WRITE_TOKEN` configurados localmente; no compartir esos valores.
- [ ] Revisar el resumen y comparar en Vercel las cuentas, categorías, productos e imágenes migrados.
- [ ] Conservar los archivos originales y la copia de seguridad hasta confirmar que la restauración y el nuevo catálogo funcionan.

## 4. Backend, panel y cuentas

- [x] Adaptar la capa de datos y las rutas de autenticación, catálogo y administración a Postgres.
- [x] Añadir `/api/health` para comprobar que la Function puede consultar la base.
- [x] Mantener el registro inicial limitado a una sola cuenta; las cuentas adicionales requieren un administrador.
- [ ] Desplegar el código actualizado en una vista previa de Vercel.
- [ ] Confirmar que `https://<vista-previa>/api/health` devuelve `{"ok":true}`.
- [ ] Probar `/admin/login`, la creación inicial de cuenta, el login y el logout.
- [ ] Probar la creación de otra cuenta desde el panel y verificar permisos de administrador.
- [ ] Confirmar que `/admin` y `/admin/app.js` no se entreguen sin sesión.

## 5. Correo y recuperación de contraseña

- [x] Publicar el formulario en `/admin/reset-password.html` y generar enlaces con esa ruta.
- [x] Adaptar creación, expiración, uso único y revocación de sesiones de los tokens a Postgres.
- [ ] Configurar y verificar el envío SMTP desde el backend desplegado.
- [ ] Solicitar un enlace nuevo, comprobar que abra el dominio definitivo y completar el cambio de contraseña.
- [ ] Comprobar que el token no pueda reutilizarse y que las sesiones anteriores queden invalidadas.
- [ ] No reutilizar el enlace de recuperación compartido anteriormente; su token quedó expuesto.

## 6. Catálogo, imágenes y pruebas funcionales

- [x] Conservar la validación de tipo MIME y firma JPG/PNG/WebP antes de almacenar imágenes.
- [x] Subir cada imagen por separado a Blob para respetar el límite de payload de Functions.
- [x] Ajustar el límite a 4 MB por imagen, con un máximo de ocho imágenes por producto.
- [ ] Probar el catálogo público, categorías, productos, WhatsApp y navegación móvil en la vista previa.
- [ ] Probar crear, editar, desactivar y eliminar productos; probar también categorías.
- [ ] Probar carga, visualización, reemplazo y borrado de imágenes en Blob.
- [ ] Confirmar que productos inactivos no aparezcan en la API pública.
- [ ] Verificar que los endpoints de API devuelvan JSON y mensajes de error claros.

## 7. Seguridad, monitoreo y copias

- [x] Mantener cookies de sesión seguras, protección CSRF y consultas parametrizadas.
- [x] Mantener límites de frecuencia para autenticación y recuperación.
- [ ] Configurar límites de frecuencia compartidos entre instancias antes de tráfico alto; los actuales son locales a cada instancia.
- [ ] Configurar copias de seguridad automáticas para Neon y Blob.
- [ ] Probar un procedimiento de restauración.
- [ ] Revisar los logs de Vercel y activar monitoreo/alertas de errores.
- [ ] Revisar dependencias y resolver alertas relevantes antes del lanzamiento.

## 8. Publicación final

- [ ] Revisar el diff y confirmar que ningún secreto ni archivo local vaya a publicarse.
- [ ] Desplegar una vista previa y completar las pruebas anteriores.
- [ ] Confirmar el despliegue de producción cuando la vista previa esté validada.
- [ ] Verificar catálogo, `/api/health`, login, panel, imágenes y recuperación en el dominio final.
- [ ] Cambiar el correo de recuperación para que use el dominio definitivo y solicitar un enlace nuevo.
- [ ] Mantener una copia de seguridad restaurable antes de anunciar el sitio.

## Criterio de salida

Brumaq está listo para publicarse cuando la base y Blob estén configurados, los datos se hayan migrado y verificado, las pruebas de catálogo, administración y recuperación pasen en producción, y exista una copia de seguridad restaurable.

Las instrucciones detalladas están en [README.md](./README.md).
