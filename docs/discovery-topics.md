# Temas de descubrimiento bilingües

La sección de búsqueda usa `GET /api/wallpapers/discovery/topics?language=es&type=all&interests=...`. El backend debe desplegarse antes que la app. No hay migración, escritura en el catálogo, cambio del índice Atlas ni llamadas de IA. La app toma el idioma de i18next, que ya respeta el idioma elegido y usa el del dispositivo inicialmente. País e idioma no se confunden.

## De dónde salen los temas

Se leen hasta 12.000 publicaciones aprobadas recientes de artistas activos. Las listas efectivas se resuelven como en el resto de la app: manual por imagen > general > IA. Las listas manuales vacías bloquean las sugerencias de IA. Un tema requiere cuatro publicaciones distintas; cuatro archivos de un carrusel no son cuatro resultados.

Se generan temas de estilos, sujetos, ambientes, colores, personajes y franquicias. Las combinaciones iniciales son sujeto + ambiente, estilo + sujeto, estilo + color y sujeto + color, únicamente cuando esos conceptos aparecen juntos en los metadatos efectivos de una imagen. Los datos generales heredados de carruseles conservan su alcance general: el sistema no reconstruye información visual ausente. No se cruzan campos de imágenes diferentes.

Los títulos se construyen con vocabulario y patrones revisados en ambos idiomas. No hay una lista fija de colecciones: «Ciudades de noche / Cities at night» solo existe si hay suficientes publicaciones que la sostienen. Los nombres propios se conservan. Estilos, sujetos, ambientes o colores desconocidos se omiten hasta añadir su vocabulario bilingüe, sin mostrar texto desconocido como si fuera una traducción. `extraTags` y las descripciones completas no se convierten automáticamente en títulos.

Se leen las 200 consultas con mayor interacción en los últimos 90 días desde `SearchSession`, con al menos cuatro resultados y una apertura, descarga o like. Las consultas en español e inglés que se puedan resolver completamente a los mismos conceptos refuerzan el mismo tema. Palabras desconocidas no se descartan para aparentar una equivalencia. La primera versión reconstruye el título bilingüe desde conceptos: no reproduce ni traduce arbitrariamente frases libres del historial. Los eventos auténticos irán cambiando el orden sin inventar popularidad.

## Respuesta y privacidad de las métricas

La respuesta contiene `version`, `language`, `type` y `topics`. Cada tema ofrece `id` estable entre idiomas, `title`, `query` en el idioma pedido, `personalized`, `origin` (`catalog` o `search`), `count` y cuatro `items` de vista previa. La consulta utiliza alias reconocidos por el buscador existente; el título no se usa como consulta. Las miniaturas proceden de la imagen coincidente cuando hay clasificación individual.

Este endpoint solo lee. Construye y valida candidatos contra el catálogo directamente, sin invocar `/search`, `saveSearchLogAsync` ni `recordSearch`. Mostrar, precargar o validar temas no crea búsquedas, clics, likes o descargas. Solo tocar un tema ejecuta una búsqueda normal. `origin: search` significa que consultas reales reforzaron un tema, no que la frase visible sea una cita literal de una consulta.

La caché del servidor guarda pools comunes durante cinco minutos, separados por imagen/video/todos; nunca guarda el perfil ni una respuesta personalizada. Las respuestas HTTP usan `private, no-store`. Los intereses se aplican después, aceptando hasta 24 pares campo/término/puntuación y el perfil plano antiguo como respaldo. Las colecciones que se solapan en al menos 80 % de la menor se excluyen de la misma pantalla; las miniaturas intentan no repetir publicaciones. Hasta dos de ocho huecos se reservan para exploración cuando hay opciones compatibles.

## Idioma, fallos y límites

Solo se responde en español o inglés. La app verifica el idioma, tipo y versión antes de mostrar datos, oculta inmediatamente el idioma/tipo anterior y cancela solicitudes al salir, cambiar idioma o cambiar filtro. Las respuestas tardías se ignoran. Sin backend compatible se muestra un mensaje traducido con reintento, sin volver a hashtags ingleses. El historial personal no se traduce.

Los títulos se calculan de manera determinista y se conservan en la caché junto con sus conceptos; no se pide una traducción por visita. Para términos nuevos se amplía el vocabulario revisado en `src/utils/discoveryTopics.js`. Más allá de 12.000 publicaciones, 20.000 candidatos o dos valores por campo para pares, conviene materializar un índice de temas. Los ocho valores permitidos de cada campo siguen participando en temas individuales. Reiniciar/desplegar actualiza el vocabulario; modificaciones del catálogo se reflejan al vencer la caché.

Comprobaciones locales: pruebas de generación, idioma, precedencia y borrados, separación por imagen, ranking, filtros, caché, permisos de visibilidad, fallos y reintentos. El catálogo de los reportes locales de migración permite una vista previa sin conexión a producción; no certifica el catálogo actual ni sustituye la validación en dispositivo.

```powershell
node --test src/utils/discoveryTopics.test.cjs src/controllers/discoveryTopicsController.test.cjs
```

En `app-wallpaper`:

```powershell
node --test src/hooks/__tests__/searchDiscovery.test.cjs src/components/search/SearchDiscovery.test.cjs src/screens/home/SearchScreen.test.cjs
node node_modules/typescript/bin/tsc --noEmit
```
