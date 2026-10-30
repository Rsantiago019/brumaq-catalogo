# Evaluación del proyecto para uso con un cliente

**Fecha:** 24 de octubre de 2026  
**Escenario considerado:** empresa que publica su inventario de maquinaria agrícola y recibe consultas por WhatsApp. Se asume que no necesita cobrar ni gestionar pedidos en línea.

## Recorrido del proyecto

1. **Visita al catálogo.** La página presenta la marca, ubicación, categorías y productos. El catálogo obtiene la configuración y los productos de la API; se puede filtrar por categoría, buscar por nombre, abrir la ficha y consultar por WhatsApp. Esto está implementado en [public/index.html](./public/index.html), [public/js/catalog.js](./public/js/catalog.js) y [src/routes/public.js](./src/routes/public.js).

2. **Consulta del producto.** La ficha tiene descripción, características e imágenes. El contacto deriva a WhatsApp: el sitio no guarda consultas, clientes potenciales ni seguimiento comercial.

3. **Acceso administrativo.** Hay inicio de sesión, cambio y recuperación de contraseña, y creación de cuentas. La cuenta inicial puede crearse desde la pantalla de acceso mientras la base no tenga usuarios; las sesiones se guardan en una cookie segura y se pueden revocar. Ver [public/js/login.js](./public/js/login.js), [src/routes/auth.js](./src/routes/auth.js) y [src/auth.js](./src/auth.js).

4. **Gestión del catálogo.** El panel permite crear, editar, activar/desactivar y eliminar productos; administrar categorías e imágenes; y crear cuentas. Los productos desactivados se ocultan del catálogo público. El panel está en [views/panel.html](./views/panel.html) y [views/admin.js](./views/admin.js); las rutas administrativas, en [src/routes/admin.js](./src/routes/admin.js).

5. **Persistencia y publicación.** Neon guarda usuarios, categorías, productos y referencias de imágenes; Vercel Blob almacena las imágenes. Vercel sirve el sitio y ejecuta la API. La configuración de rutas está en [vercel.json](./vercel.json).

## Ajustes recomendados antes de ofrecerlo

| Prioridad | Hallazgo | Recomendación |
|---|---|---|
| **P0 — alcance por cliente** | El sistema funciona como un solo catálogo/empresa por base de datos; no tiene separación multiempresa. | Para venderlo a varias empresas, empezar con un proyecto, base, almacén de imágenes y dominio por cliente. Si se quiere una sola plataforma compartida, diseñar y probar aislamiento de datos por empresa antes de incorporar clientes. |
| **P0 — primera cuenta** | Si la base aún no tiene usuarios, el alta inicial se habilita desde la pantalla pública de acceso. | Crear el primer administrador antes de anunciar el sitio, o proteger el alta inicial con una invitación/secreto de un solo uso. |
| **P1 — ficha comercial** | La ficha no incluye campos propios de inventario comercial como marca, modelo, año, horas, precio, condición o disponibilidad; las características actuales son flexibles, pero no estructuradas. | Definir esos campos con el cliente. Para maquinaria usada, considerar estados como disponible, reservado y vendido; permitir ocultar precio o usar “consultar” según la política comercial. |
| **P1 — consultas** | WhatsApp facilita el contacto, pero la empresa no puede revisar desde el panel cuántas consultas llegaron ni a qué producto. | Si necesita seguimiento, agregar un formulario o registro de consultas con consentimiento, estado, responsable y exportación; si WhatsApp basta, personalizar y probar el mensaje, teléfono y enlaces. |
| **P1 — cuentas y permisos** | Las cuentas nuevas se crean como administradores. Existe el rol `editor` en la base, pero no hay gestión de usuarios ni permisos diferenciados completos en el panel. | Añadir roles realmente aplicados —por ejemplo, administrador y vendedor—, desactivar/eliminar cuentas y registrar cambios. |
| **P1 — eliminación y recuperación** | Borrar un producto elimina su ficha; no hay papelera, historial ni deshacer. Las imágenes también son públicas. | Preferir archivar o marcar como vendido cuando el cliente necesita historial. Definir retención y copias de seguridad de Neon y Blob. No usar el almacén público para documentos privados. |
| **P1 — correo** | En logs revisados de un despliegue anterior figuraba un error SMTP `535 Authentication failed`; eso no confirma el estado actual, pero sí merece una prueba antes de depender de la recuperación por email. | Verificar credenciales SMTP y completar un restablecimiento en staging con un buzón de prueba. La variable de configuración por sí sola no demuestra que el proveedor acepte el envío. |
| **P1 — imágenes y despliegue** | El código actual permite al SDK usar autenticación gestionada de Vercel, pero parte de la guía todavía presenta `BLOB_READ_WRITE_TOKEN` como requisito de producción. | Alinear [README.md](./README.md), [DEPLOYMENT-CHECKLIST.md](./DEPLOYMENT-CHECKLIST.md) y [scripts/migrate-to-vercel.js](./scripts/migrate-to-vercel.js) con la configuración Blob vigente. Probar carga, edición y borrado de imágenes con el almacén del entorno que se entregará al cliente. |
| **P1 — pruebas** | Hay una prueba de humo, pero escribe datos temporales, usa servicios reales y puede enviar un correo. No equivale a una suite rápida y aislada para cada cambio. | Añadir pruebas de validación, API y permisos con base/servicios de prueba; mantener una prueba de integración en staging y nunca usarla contra datos reales sin autorización. |
| **P2 — crecimiento** | El catálogo carga todos los productos y la serialización consulta imágenes por producto. La búsqueda actual solo mira el nombre. | Para inventarios grandes, agregar paginación, búsqueda en servidor —incluidas características si sirven al cliente— y una lectura de imágenes más eficiente. |
| **P2 — presencia comercial** | La ubicación del texto y parte del contenido de portada son estáticos; también hay dependencias externas para mapa, fuentes y animación. | Confirmar marca, textos, horarios y área de servicio; acordar privacidad/cookies y política de datos; revisar accesibilidad móvil, SEO básico, imágenes optimizadas y funcionamiento si falla un servicio externo. |
| **P2 — operación** | La guía de publicación tiene pasos pendientes y no refleja por completo los últimos cambios de despliegue. El esquema se inicializa desde la aplicación. | Mantener una lista de salida real por cliente, usar migraciones de base versionadas, configurar alertas y ensayar una restauración antes de la entrega. Revisar cuidadosamente [scripts/seed.js](./scripts/seed.js): `--reset` reemplaza datos de demostración y no debe ejecutarse sobre información del cliente. |

## Evaluación general

El proyecto se puede describir hoy como **un catálogo público con consultas por WhatsApp y panel administrativo**, no como tienda en línea ni como SaaS multiempresa. Para un primer cliente de tamaño pequeño, la ruta más segura es un despliegue aislado y personalizado, con su dominio, usuarios, base, Blob y respaldos. Si el cliente espera ventas, reservas, inventario compartido, varios locales o seguimiento de prospectos, eso debe acordarse como alcance adicional.

## Alcance de esta revisión

La revisión cubrió el código, las rutas y la documentación; no se hicieron altas ni bajas en datos del cliente. Aunque la API de salud y la página de acceso respondieron correctamente en una verificación anterior, eso no sustituye una prueba autorizada del CRUD completo en staging, especialmente carga, reemplazo y borrado de imágenes.
