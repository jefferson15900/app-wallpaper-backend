# Metadatos de wallpapers · versión 1

Implementado el 18 de octubre de 2026. No ejecuta una migración del catálogo ni exige embeddings o servicios nuevos.

## Contrato

`metadata` es un objeto parcial con listas de texto: `subjects`, `styles`, `colors`, `environments`, `characters` y `extraTags`. También se aceptan las claves españolas `sujetos`, `estilos`, `colores`, `ambientes`, `personajes` y `etiquetasAdicionales` al importar JSON. No se aceptan claves desconocidas ni dos nombres del mismo campo en un objeto.

Hasta 8 términos por campo y 20 en `extraTags`, 80 caracteres por término, 10 archivos por envío. Los valores se normalizan a minúsculas sin acentos; las equivalencias conocidas se convierten a inglés. Los términos desconocidos se conservan dentro del campo elegido, sin inventar una traducción ni clasificar las etiquetas antiguas.

```json
{
  "subjects": ["city"],
  "styles": ["cyberpunk"],
  "colors": ["blue", "purple"],
  "environments": ["night", "rain"],
  "characters": [],
  "extraTags": []
}
```

`Wallpaper.metadata` es información manual general. Cada elemento de `images[]` nuevo tiene `assetId` UUID, `metadata` manual, `aiMetadata` automático y `analysis`. Los resultados de IA no reemplazan datos manuales. La precedencia por campo es: metadatos del archivo > metadatos generales > IA. Un campo manual omitido admite sugerencias; una lista manual vacía elimina expresamente ese atributo de las sugerencias efectivas.

`manualTags` conserva las etiquetas generales del usuario. `tags` sigue siendo la proyección compatible para las búsquedas y tarjetas existentes: unión de etiquetas generales y términos efectivos de los metadatos, usando solo los términos canónicos conocidos en inglés (`city`, `night`, etc.), sin añadir traducciones españolas como etiquetas duplicadas. Las equivalencias se aplican al interpretar consultas: `ciudad noche` puede encontrar `city night`. El texto libre desconocido no se traduce automáticamente. Los términos de metadatos no pasan por la blacklist del etiquetado antiguo, por lo que `rain`, `night` y `pixel art` permanecen. Se corrigió el alias que confundía lluvia con agua. Esto se aplica a nuevos guardados; no se ejecutó limpieza del catálogo existente.

No se necesita cambiar el índice Atlas para esta etapa porque continúa buscando en `tags`. Su configuración desplegada y el comportamiento con datos reales se deben comprobar antes de lanzar. `matchedAssetId` se devuelve cuando todos los términos limpios de la consulta se reconocen literalmente en los metadatos efectivos de una misma imagen; si depende de fuzzy, etiquetas generales o cruza imágenes, puede omitirse. No es una búsqueda vectorial ni una garantía de precisión visual.

## APIs

- `GET /api/wallpapers/metadata/schema`: versión, campos, límites y confirmación de IA optativa. La app lo comprueba antes de enviar archivos con el contrato nuevo; se almacena en memoria mientras vive el proceso de la app.
- `POST /api/wallpapers/upload`: mantiene `tags`, `useAI`, `manualAIResult` y archivos `image`. Añade `metadata` como JSON general opcional y `assetMetadata` como arreglo JSON de un objeto por archivo, en el mismo orden. No admite mezclar imágenes y videos.
- `PUT /api/admin/pending/:id`: edición administrativa de pendientes. Admite `metadata` y `assetMetadata: [{assetId, metadata}]`, además de etiquetas, precio y destacado. Cada objeto sustituye los metadatos manuales del archivo indicado; los archivos no incluidos se conservan. Se validan pertenencia y duplicados. Los cambios usan revisión para evitar sobrescribir una respuesta concurrente de IA; se mantiene el filtro atómico de estado pendiente.
- `PUT /api/admin/retry-ai/:id`: solicita exactamente una imagen. El body opcional `{assetId}` selecciona el archivo; sin él se usa el primero. Rechaza videos, medios antiguos sin assetId y trabajos ya pendientes o procesándose. Es una operación explícita que puede generar costo. No reanaliza todo un carrusel.

La fusión administrativa materializa los metadatos generales de cada origen en sus archivos antes de combinar, evitando heredar datos de otra imagen. Actualización, eliminación del secundario y contador de artista se ejecutan en una misma transacción MongoDB, con incremento de revisión; requiere replica set (incluido en Atlas). Rechaza tipos mezclados, más de 10 medios y análisis IA pendientes o en curso. No elimina el secundario si la transacción falla.

## IA y presupuesto

Apagada por defecto en el formulario y en el backend. Solo `useAI="true"` solicita análisis al subir. La interfaz indica el número de archivos. El JSON manual evita las llamadas de IA y mantiene compatibilidad con el arreglo antiguo de pares `{en, es}`; el objeto estructurado manual solo corresponde a un envío de una imagen.

Se usa un modelo configurado por `WALLPAPER_AI_MODEL`, con valor predeterminado `gemini-2.5-flash`, y la clave existente `GOOGLE_AI_KEY`. Se solicita JSON con los seis campos, máximo 1.024 tokens de salida y thinkingBudget 0 para la familia 2.5 Flash. Se valida el resultado en el servidor. No hay fallback a Pro ni reintentos automáticos de inferencia. La disponibilidad del modelo y el consumo facturado deben comprobarse con una prueba voluntaria antes de habilitar IA en producción.

Se analiza una copia Cloudinary HTTPS JPEG limitada a 768 px de ancho, con descarga de máximo 10 MB. La transformación puede consumir créditos de Cloudinary. El nombre o el texto de una imagen no se tratan como instrucciones del modelo.

`images[].analysis` actúa como cola persistente en MongoDB: `not_requested`, `pending`, `processing`, `succeeded`, `failed`. El servidor inicia un worker tras conectar la base de datos, consulta cada cinco segundos y reclama un archivo de forma atómica. Un lease vencido se marca fallido; no se repite automáticamente una petición que pudo haber sido facturada. Los trabajos pendientes conservan su autorización tras reiniciar. Cerrar la app móvil no cancela los trabajos que ya se guardaron con una subida.

## Interfaz y compatibilidad

El formulario conserva el tema oscuro y Montserrat de Vexel. Ofrece campos separados, opciones táctiles, entrada libre y selección de cada imagen; aplicar a todas pide confirmar que se reemplazarán los demás campos. La copia del borrador se conserva en reintentos de subida. El JSON manual se valida antes de iniciar el lote para no bloquear un borrador inválido. En revisión, los metadatos se editan por assetId y las sugerencias de IA se pueden copiar sin otra llamada; también se puede solicitar un análisis individual explícito, con aviso de costo y protección contra doble pulsación. Las imágenes antiguas siguen con etiquetas generales; editar un carrusel antiguo no inventa metadatos individuales. El detalle abre la imagen indicada por matchedAssetId cuando existe.

## Entrega y comprobación

Desplegar primero el backend y después la app. No se ejecutaron migraciones, llamadas de pago ni conexiones al catálogo de producción durante el desarrollo. Los registros existentes siguen funcionando con sus tags; no se les asignaron personajes, estilos ni colores mediante suposiciones.

Pruebas locales: normalización, validación, proyección de búsqueda, precedencia manual, selección por archivo, escrituras concurrentes, cola sin reintentos de pago, HTTP de revisión, subida idempotente y rechazo de backend antiguo. Se usan mocks en lugar de Atlas, Cloudinary y Gemini. Comprobar después en un dispositivo las pantallas de subida/revisión, la continuidad de la galería y la configuración real del índice. La migración por lotes y la mejora general de paginación quedan para tareas posteriores.
