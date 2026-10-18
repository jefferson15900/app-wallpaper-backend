# Metadatos de wallpapers · versión 1

Implementado el 18 de octubre de 2026. No ejecuta una migración del catálogo ni exige embeddings o servicios nuevos.

## Contrato

`metadata` es un objeto parcial con listas de texto: `subjects`, `styles`, `colors`, `environments`, `characters`, `franchises` y `extraTags`. También se aceptan las claves españolas `sujetos`, `estilos`, `colores`, `ambientes`, `personajes`, `franquicias` (o `series`) y `etiquetasAdicionales` al importar JSON. No se aceptan claves desconocidas ni dos nombres del mismo campo en un objeto.

`franchises` corresponde al campo opcional «Serie o franquicia» del formulario y del editor. Distingue un personaje (`meowth`) de su franquicia (`pokemon`). Permite hasta 8 nombres; se normalizan sin generar etiquetas españolas duplicadas. La adición del campo no mueve automáticamente términos del catálogo ya migrado desde `extraTags`.

`description` es texto opcional de hasta 240 caracteres por imagen, separado de las siete listas. Admite las claves `descripcion` y `descripción` en JSON. Conserva mayúsculas y puntuación, compacta espacios y rechaza tipos incorrectos y controles. Una descripción manual vacía (`""`) descarta expresamente la descripción de IA; omitir el campo permite usarla. Se edita en subida y revisión y no se muestra como texto ni como etiqueta en el detalle público.

Hasta 8 términos por campo y 20 en `extraTags`, 80 caracteres por término, 10 archivos por envío. Los valores se normalizan a minúsculas sin acentos; las equivalencias conocidas se convierten a inglés. Los términos desconocidos se conservan dentro del campo elegido, sin inventar una traducción ni clasificar las etiquetas antiguas.

```json
{
  "subjects": ["city"],
  "styles": ["cyberpunk"],
  "colors": ["blue", "purple"],
  "environments": ["night", "rain"],
  "characters": [],
  "franchises": [],
  "extraTags": [],
  "description": "A girl stands in the rain on a city street."
}
```

`Wallpaper.metadata` es información manual general. Cada elemento de `images[]` nuevo tiene `assetId` UUID, `metadata` manual, `aiMetadata` automático y `analysis`. Los resultados de IA no reemplazan datos manuales. La precedencia por campo es: metadatos del archivo > metadatos generales > IA. Un campo manual omitido admite sugerencias; una lista manual vacía elimina expresamente ese atributo de las sugerencias efectivas.

`manualTags` conserva las etiquetas generales del usuario. `tags` sigue siendo la proyección compatible para las búsquedas y tarjetas existentes: unión de etiquetas generales y términos efectivos de los metadatos, usando solo los términos canónicos conocidos en inglés (`city`, `night`, etc.), sin añadir traducciones españolas como etiquetas duplicadas. Las equivalencias se aplican al interpretar consultas: `ciudad noche` puede encontrar `city night`. El texto libre desconocido no se traduce automáticamente. Los términos de metadatos no pasan por la blacklist del etiquetado antiguo, por lo que `rain`, `night` y `pixel art` permanecen. Se corrigió el alias que confundía lluvia con agua. Esto se aplica a nuevos guardados; no se ejecutó limpieza del catálogo existente.

`searchDescriptions` es una proyección interna con las descripciones efectivas de todas las imágenes, sin duplicados. Se recalcula al subir, completar IA, editar y fusionar. No se mezcla con `tags` ni alimenta el vocabulario de autocompletado. La búsqueda consulta ambos campos, conserva cada concepto obligatorio y añade puntuación por coincidencias de texto y frases en la descripción. Las equivalencias conocidas permiten consultas como «una chica bajo la lluvia en la ciudad» o «un hombre demonio de color rojo». No traduce arbitrariamente todo texto libre ni garantiza entender qué objeto tiene cada color; las frases aportan una señal adicional.

**Antes de desplegar este backend:** comprobar que el índice Atlas `default` indexa `searchDescriptions` como `string` con posiciones y análisis compatible con `tags`. Añadir el fragmento de [atlas-description-fields.json](atlas-description-fields.json) dentro de `mappings.fields` del índice existente, conservando sus otros campos y opciones. Si el índice ya usa mapping dinámico compatible, verificarlo antes de cambiarlo. Esperar a que el índice esté listo y comprobar consultas con una descripción y con un documento antiguo. No se actualizó el índice remoto durante este cambio. Un mapping sin el campo nuevo no ofrece esta recuperación y puede rechazar operadores de frase.

Referencia de configuración: [campos string de MongoDB Search](https://www.mongodb.com/docs/search/indexes/field-types/string-type/) y [operador phrase](https://www.mongodb.com/docs/search/query/operators-collectors/phrase/).

`matchedAssetId` se devuelve cuando todos los términos canónicos de la consulta se reconocen literalmente en los metadatos o la descripción efectiva de una misma imagen; si depende de fuzzy, etiquetas generales o cruza imágenes, puede omitirse. No es una búsqueda vectorial ni una garantía de precisión visual. La versión del buscador es `metadata-text-v3-description-variety15`; invalida continuaciones de la versión anterior para no mezclar rankings y mantiene el 15 % de variedad acordado.

## APIs

- `GET /api/wallpapers/metadata/suggestions?field=characters&q=me`: autocompletado por cada uno de los siete campos. Solo lee los metadatos efectivos del catálogo aprobado (archivo > generales > IA; una lista manual vacía bloquea la IA). Devuelve hasta 12 valores normalizados, sin duplicados, con equivalencias conocidas en español y valores canónicos en inglés. Ordena prefijos primero y después frecuencia. Caché compartida de 60 segundos por campo, hasta 10.000 términos por campo; no usa IA ni modifica datos. La app espera 300 ms al escribir, descarta respuestas anteriores y permite entrada manual si falla o no hay coincidencias. Disponible en subida y edición.

- `GET /api/wallpapers/metadata/schema`: versión, campos, límites, confirmación de IA optativa y capacidad `description: {supported: true, maxLength: 240}`. La app comprueba la capacidad antes de enviar una descripción para evitar que un backend antiguo la descarte; se almacena en memoria mientras vive el proceso de la app.
- `POST /api/wallpapers/upload`: mantiene `tags`, `useAI`, `manualAIResult` y archivos `image`. Añade `metadata` como JSON general opcional y `assetMetadata` como arreglo JSON de un objeto por archivo, en el mismo orden. No admite mezclar imágenes y videos.
- `PUT /api/admin/pending/:id`: edición administrativa de pendientes. Admite `metadata` y `assetMetadata: [{assetId, metadata}]`, además de etiquetas, precio y destacado. Cada objeto sustituye los metadatos manuales del archivo indicado; los archivos no incluidos se conservan. Se validan pertenencia y duplicados. Los cambios usan revisión para evitar sobrescribir una respuesta concurrente de IA; se mantiene el filtro atómico de estado pendiente.
- `PUT /api/admin/retry-ai/:id`: solicita exactamente una imagen. El body opcional `{assetId}` selecciona el archivo; sin él se usa el primero. Rechaza videos, medios antiguos sin assetId y trabajos ya pendientes o procesándose. Es una operación explícita que puede generar costo. No reanaliza todo un carrusel.

La fusión administrativa materializa los metadatos generales de cada origen en sus archivos antes de combinar, evitando heredar datos de otra imagen. Actualización, eliminación del secundario y contador de artista se ejecutan en una misma transacción MongoDB, con incremento de revisión; requiere replica set (incluido en Atlas). Rechaza tipos mezclados, más de 10 medios y análisis IA pendientes o en curso. No elimina el secundario si la transacción falla.

## IA y presupuesto

Apagada por defecto en el formulario y en el backend. Solo `useAI="true"` solicita análisis al subir. La interfaz indica el número de archivos. El JSON manual evita las llamadas de IA y mantiene compatibilidad con el arreglo antiguo de pares `{en, es}`; el objeto estructurado manual solo corresponde a un envío de una imagen.

Se usa un modelo configurado por `WALLPAPER_AI_MODEL`, con valor predeterminado `gemini-2.5-flash`, y la clave existente `GOOGLE_AI_KEY`. Se solicita JSON con las siete listas y una frase descriptiva en inglés en la misma llamada, máximo 1.024 tokens de salida y thinkingBudget 0 para la familia 2.5 Flash. El prompt pide acciones, relaciones y a qué pertenecen los colores visibles, sin inventar identidad o historia. Se valida el resultado en el servidor; los análisis nuevos usan `analysis.version: 2`, sin invalidar los anteriores. No hay una segunda llamada para redactar la descripción, fallback a Pro ni reintentos automáticos de inferencia. El texto adicional puede aumentar los tokens consumidos dentro del mismo límite; no se promete costo idéntico. La disponibilidad del modelo y el consumo facturado deben comprobarse con una prueba voluntaria antes de habilitar IA en producción.

Se analiza una copia Cloudinary HTTPS JPEG limitada a 768 px de ancho, con descarga de máximo 10 MB. La transformación puede consumir créditos de Cloudinary. El nombre o el texto de una imagen no se tratan como instrucciones del modelo.

`images[].analysis` actúa como cola persistente en MongoDB: `not_requested`, `pending`, `processing`, `succeeded`, `failed`. El servidor inicia un worker tras conectar la base de datos, consulta cada cinco segundos y reclama un archivo de forma atómica. Un lease vencido se marca fallido; no se repite automáticamente una petición que pudo haber sido facturada. Los trabajos pendientes conservan su autorización tras reiniciar. Cerrar la app móvil no cancela los trabajos que ya se guardaron con una subida.

## Interfaz y compatibilidad

El formulario conserva el tema oscuro y Montserrat de Vexel. Ofrece campos separados, opciones táctiles, entrada libre y selección de cada imagen; aplicar a todas pide confirmar que se reemplazarán los demás campos. La copia del borrador se conserva en reintentos de subida. El JSON manual se valida antes de iniciar el lote para no bloquear un borrador inválido. En revisión, los metadatos se editan por assetId y las sugerencias de IA se pueden copiar sin otra llamada; también se puede solicitar un análisis individual explícito, con aviso de costo y protección contra doble pulsación. Las imágenes antiguas siguen con etiquetas generales; editar un carrusel antiguo no inventa metadatos individuales. El detalle abre la imagen indicada por matchedAssetId cuando existe.

## Entrega y comprobación

Preparar y verificar el índice Atlas, desplegar el backend y después la app. No se ejecutaron migraciones, llamadas de pago ni conexiones al catálogo de producción durante el desarrollo. Los registros existentes siguen funcionando con sus tags; no se les asignaron descripciones, personajes, estilos ni colores mediante suposiciones. Las descripciones se incorporan al guardarlas manualmente o al realizar un análisis autorizado; no se reprocesa el catálogo automáticamente.

Pruebas locales: normalización, validación de descripciones, proyección de búsqueda sin contaminar etiquetas, precedencia manual, selección por archivo, escrituras concurrentes, cola sin reintentos de pago, HTTP de revisión, subida idempotente, búsqueda por descripción con errores de escritura, continuidad de cursor y rechazo de backend antiguo. Se usan mocks en lugar de Atlas, Cloudinary y Gemini. Comprobar después en un dispositivo las pantallas de subida/revisión, la continuidad de la galería y la configuración real del índice. No se ejecuta una migración ni análisis del catálogo antiguo.
