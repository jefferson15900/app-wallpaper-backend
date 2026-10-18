# Migración de las etiquetas existentes

El script usa la `MONGO_URI` del entorno o del `.env` del backend sin mostrar credenciales. No llama a Gemini, no descarga archivos ni modifica usuarios, precios, likes, descargas o estados de aprobación. La selección de nombres y conceptos es explícita en `src/utils/legacyWallpaperMetadata.js`; no usa inferencias sobre imágenes ni traduce texto desconocido.

## Pasos

Desde `app-backend-wallpaper`:

```powershell
# Solo lee. Genera plan, resumen y reporte en reports/metadata-migration/.
node scripts/migrate-wallpaper-metadata.cjs --dry-run

# Aplicar exactamente el plan revisado (sustituir la ruta).
node scripts/migrate-wallpaper-metadata.cjs --apply --plan reports/metadata-migration/RUN/plan.jsonl

# Revertir solo registros que aún conserven los valores escritos por esa migración.
node scripts/migrate-wallpaper-metadata.cjs --rollback reports/metadata-migration/RUN/backup-applied.jsonl
```

La simulación es el modo predeterminado. `--out DIRECTORIO` permite elegir un directorio nuevo. El plan se fija por SHA-256 y por una huella de la base de datos de destino. Aplicarlo dos veces usando el mismo directorio se impide para no sobrescribir su respaldo; una simulación nueva omite registros ya estructurados.

## Qué cambia

- Cada etiqueta conserva su texto original en `manualTags` y en el respaldo. Los términos reconocidos alimentan sujeto, estilo, color, ambiente o personaje. Los compuestos explícitos como `anime girl` se separan en estilo y sujeto, conservando además la etiqueta original para búsqueda.
- Franquicias y términos ambiguos como `lucy`, `power`, `dark`, marcas o nombres no revisados se guardan en `extraTags` y aparecen en el reporte. No se adivina qué personaje o propiedad representan.
- Para una publicación de un archivo se completan `images[0].metadata`, `assetId` y estado `not_requested` si no existía estado. Si no había `images[]`, se construye con la URL e identificador de almacenamiento existentes; no se vuelve a subir la imagen.
- Para un carrusel se completan los campos generales `Wallpaper.metadata`, conservando intactos los archivos. Sus etiquetas anteriores eran generales y no permiten conocer a qué imagen individual corresponden. No se distribuyen por suposición ni se duplica la misma clasificación en todas las imágenes.
- Se calcula `tags` para búsqueda con los términos canónicos conocidos en inglés, sin añadir traducciones españolas duplicadas y sin duplicar variantes de acentos. Los valores originales se conservan en `manualTags` y en el respaldo.
- Se registran `metadataVersion`, `metadataRevision` y `metadataMigration` con versión, ejecución, fecha y alcance. Los registros ya estructurados se omiten. También se omiten datos inválidos, límites excedidos o análisis de IA activos.

## Protección y verificación

Antes de escribir cada lote de 100 registros se guarda y se sincroniza a disco su respaldo Extended JSON, preservando ObjectIds y fechas. La escritura comprueba que etiquetas, metadatos, revisión, imágenes, URLs y estado siguen iguales al plan: una edición concurrente provoca que ese registro no se toque. No hay upserts ni borrados.

Cada lote se vuelve a leer y se compara con sus valores previstos. `apply-result.json` registra escrituras, conflictos y verificación. El script comprueba que cada etiqueta previa siga representada en la búsqueda y rechaza planes que la pierdan. La reversión usa los valores posteriores como condición; no sobrescribe una edición o análisis más reciente. Los respaldos y reportes están excluidos de Git porque contienen datos del catálogo.

Las comprobaciones unitarias se ejecutan con:

```powershell
node --test src/utils/legacyWallpaperMetadata.test.cjs src/utils/wallpaperMetadata.test.cjs
```

Esta migración no genera atributos que no estaban etiquetados ni reconstruye detalles perdidos por prompts anteriores. Los términos en `extraTags` siguen teniendo su valor, aunque todavía no se conozca una categoría más específica.
