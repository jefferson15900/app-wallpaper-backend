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

## Completar Serie o franquicia

La segunda migración (`franchises-v1`) mueve títulos reconocidos desde `metadata.extraTags` al campo `franchises` de ese mismo objeto. Conserva la clasificación por imagen o general del carrusel, personajes, datos de IA, etiquetas originales, URLs e identificadores. Añade el nombre inglés a la búsqueda sin eliminar ningún valor previo. No distribuye datos generales entre imágenes ni deduce una obra a partir de nombres ambiguos como Lucy, Power, Naruto o Spider-Man. Tampoco reemplaza un campo `franchises: []` explícito.

```powershell
node scripts/migrate-wallpaper-metadata.cjs --franchises --dry-run
node scripts/migrate-wallpaper-metadata.cjs --franchises --apply --plan reports/metadata-migration/RUN/plan.jsonl
node scripts/migrate-wallpaper-metadata.cjs --franchises --rollback reports/metadata-migration/RUN/backup-applied.jsonl
node --test src/utils/franchiseWallpaperMetadata.test.cjs src/utils/legacyWallpaperMetadata.test.cjs
```

Comparte el respaldo previo a escritura, huella del destino, hash del plan, guardas de concurrencia y verificación de la migración anterior. Conserva también su marcador histórico `metadataMigration`; el identificador de esta segunda ejecución queda en el plan y el respaldo. Repetir la simulación omite los títulos ya trasladados.

Las equivalencias están en `src/utils/franchiseWallpaperMetadata.js`. Se consultaron fuentes oficiales para las abreviaturas y títulos menos claros:

- [NTE / Neverness to Everness, Perfect World](https://nte.perfectworld.com/en/article/news/gamenews/20260428/261950.html).
- [Arknights: Endfield, Gryphline](https://endfield.gryphline.com/en-us/news/9574).
- [That Time I Got Reincarnated as a Slime, Kodansha](https://licensing.kodansha.com/title/that-time-i-got-reincarnated-as-a-slime/).
- [Goddess of Victory: NIKKE, sitio oficial](https://nikke-en.com/download.html).
- [Umamusume: Pretty Derby, Cygames](https://support.umamusume.com/).
- [Frieren: Beyond Journey’s End, VIZ](https://www.viz.com/frieren-beyond-journeys-end).
- [Dr. STONE, VIZ](https://www.viz.com/dr-stone).
- [OSHI NO KO, sitio oficial del anime](https://ichigoproduction.com/).
- [Stranger Things, Netflix](https://www.netflix.com/title/80057281).
- [Courage the Cowardly Dog, Cartoon Network](https://www.cartoonnetwork.com/legal/ratings.html) y [Coraje, el perro cobarde, Apple TV](https://tv.apple.com/us/show/coraje-el-perro-cobarde/umc.cmc.52kiq5vixkr92qxs8ieojmbjl?l=es).
