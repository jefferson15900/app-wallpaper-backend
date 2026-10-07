# Estadísticas del panel maestro

El panel usa `GET /api/admin/stats?days=7|30|90`, protegido por autenticación y rol administrador. La respuesta tiene `version: 2`. Mantiene claves de compatibilidad para las versiones instaladas que todavía consultan `/stats` sin período.

## Registro

- `/api/admin/ping`: registra actividad de un dispositivo. La app lo llama al abrirse, al volver a primer plano y cada cinco minutos mientras sigue activa. Un índice único por dispositivo y día evita duplicar actividad.
- Cada búsqueda de la app actualizada genera un identificador y lo mantiene al paginar. Solo la primera página registra una búsqueda, con el número real de resultados devueltos por el buscador. No se usa una coincidencia aproximada de etiquetas para afirmar que no hay contenido.
- Aperturas, likes y descargas usan indicadores separados por búsqueda. Repetir una apertura o descargar varios wallpapers no aumenta el número de búsquedas convertidas. La conversión se atribuye al día de la búsqueda y puede actualizarse con interacciones posteriores.
- Las descargas se registran en una colección independiente del wallpaper; borrar o fusionar contenido no borra su histórico nuevo. El ranking conserva la cantidad de descargas aunque el contenido se retire.
- Se conserva el registro agregado anterior de búsquedas por compatibilidad. Su limpieza, desde Mantenimiento, no afecta las nuevas colecciones de estadísticas.

## Definiciones

Los períodos incluyen los últimos N días completos según `America/Lima`, y excluyen hoy. La actividad de hoy aparece aparte. Los dispositivos del período se deduplican entre días: no son la suma de activos diarios. Un dispositivo nuevo significa primer registro en el servidor, no una instalación verificada ni una persona nueva.

La retención D3 usa el registro original e inmutable del dispositivo y exige actividad en el tercer día calendario. No depende de la última descarga. Se excluyen cohortes anteriores al primer día completo de medición y las que aún no completan D3. La respuesta incluye el tamaño del grupo y los retornos. Un grupo vacío tiene tasa `null`.

Las comparaciones de actividad y resultados requieren los dos períodos completos posteriores al inicio de medición. Una base anterior de cero tiene diferencia porcentual `null`; el panel muestra el valor anterior. Las series muestran `null` para días sin histórico, y cero para días completos medidos sin actividad registrada. El primer día de puesta en marcha se trata como parcial.

Las cifras de la galería son el estado actual de wallpapers aprobados, sus likes actuales y sus contadores de descargas acumulados. Se presentan aparte del histórico de eventos.

## Puesta en marcha

1. Desplegar el backend primero. Al conectar con MongoDB se guarda una fecha persistente de inicio de medición. Mongoose define índices por fecha y por identificadores únicos. Se necesita MongoDB 5 o posterior para las operaciones de fecha de las cohortes.
2. Publicar la app actualizada para habilitar actividad al volver a primer plano y atribución de búsquedas. Los clientes anteriores todavía registran descargas, pero no envían identificadores de búsqueda.
3. No se inventa ni se rellena histórico anterior. Los primeros días el panel indica histórico parcial y muestra — donde no existe una base suficiente.

No se han ejecutado migraciones ni consultas sobre la base de producción. Los tests del controlador usan dobles de base de datos; queda validar el pipeline con MongoDB del entorno de pruebas y comprobar las pantallas en dispositivo con datos reales.

## Comprobaciones

Backend: `node --test src/services/analytics.test.cjs src/controllers/approvalQueue.test.cjs src/controllers/relatedWallpapers.test.cjs src/controllers/pendingReviewController.test.cjs`.

App: `node --test src/hooks/__tests__/adminStatistics.test.cjs`, `node node_modules/typescript/bin/tsc --noEmit` y `node node_modules/expo/bin/cli export --platform android --output-dir .statistics-verify --no-minify`.
