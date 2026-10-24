# Diccionario inglés–español para búsquedas

FreeDict + WikDict `eng-spa`, edición `2025.11.23`, se importa a MongoDB en
`searchdictionary`. Son datos descargables: buscar no llama a servicios externos,
no usa créditos y no tiene cuota externa de traducción.

## Carga

Se necesita Node >=22.18, `tar`, las dependencias de desarrollo y `MONGO_URI` en
el entorno o `.env` del backend. El servidor conserva sus dependencias actuales;
el parser XML solo se utiliza al cargar los datos.

```sh
npm ci
npm run dictionary:prepare
npm run dictionary:import
```

`prepare` descarga la versión fijada, comprueba SHA-512, prepara las entradas y
escribe un informe en `reports/freedict/plan.json`. `import` inserta los datos por
lotes, crea el índice `dictionary_terms`, verifica cantidad y ejemplos y guarda
`reports/freedict/result.json`. Puede repetirse: los identificadores son estables
y `$setOnInsert` conserva los registros existentes. No escribe en `tagmaps` ni
modifica publicaciones. No ejecuta una importación al iniciar el servidor.

La colección `dictionaryimports` conserva versión, atribución, procedencia,
licencia, conteos y tamaño de la carga. Los archivos descargados y preparados se
ignoran en Git y no se empaquetan en la app móvil.

## Comportamiento

`resolveSearchConcepts` consulta el diccionario por palabras y frases normalizadas,
incluyendo candidatos de singular. Cada acepción se guarda por separado con su
categoría gramatical y definición. Los alias locales y `TagMap` tienen prioridad;
los términos desconocidos se amplían con las equivalencias del diccionario.
Una búsqueda como «una ardilla azul» puede encontrar etiquetas `squirrel, blue`
o una descripción equivalente, manteniendo ambos conceptos obligatorios.

No se elige una traducción arbitraria para reescribir etiquetas guardadas. Las
alternativas de búsqueda no se aprenden como equivalencias globales ni se encadenan
entre acepciones: «ribera» puede encontrar `bank`, pero no se transforma en «banco».
Las palabras ambiguas siguen pudiendo recuperar varios sentidos; no se infiere el
contexto de una oración completa. El diccionario no garantiza cobertura universal.

Cada lectura está limitada a 2.000 acepciones y 1 segundo de ejecución en MongoDB;
cada término aporta hasta 24 alternativas para acotar el tamaño de la consulta
Atlas. Si el diccionario falla, siguen funcionando los alias conocidos y el texto
original. No se necesita un índice Atlas adicional para esta colección: se usa un
índice normal de MongoDB y luego el índice de wallpapers ya existente.

## Fuente, licencia y tamaños

- Autor/mantenedor: Karl Bartel; WikDict y FreeDict; base Wiktionary vía DBnary.
- [Fuente original y descarga](https://freedict.org/downloads/).
- [Archivo fuente de esta versión](https://download.freedict.org/dictionaries/eng-spa/2025.11.23/freedict-eng-spa-2025.11.23.src.tar.xz).
- Licencia indicada en el TEI: [CC BY-SA 3.0 Unported](https://creativecommons.org/licenses/by-sa/3.0/).
  Conservar esta atribución y la licencia al distribuir los datos adaptados; las
  adaptaciones del diccionario se ofrecen bajo esa misma licencia.
- Adaptación de Vexel: normalización de términos, selección de citas españolas,
  separación por acepción, exclusión de términos vacíos, sin letras/números o de
  más de 80 caracteres, y deduplicación de registros idénticos.
- 64.258 entradas fuente → 76.734 acepciones → 134.726 términos normalizados distintos.
- Descarga: 3.715.012 bytes (3,72 MB); XML: 34.358.251 bytes (34,36 MB).
- Datos adaptados JSONL: 26.836.126 bytes (26,84 MB). El informe de importación mide
  por separado datos BSON, almacenamiento comprimido e índices reales en MongoDB.
- Carga comprobada: 29.508.256 bytes BSON; 6.594.560 bytes de almacenamiento y
  6.688.768 bytes de índices (13,28 MB combinados; estas cifras pueden cambiar con
  la compactación de MongoDB). El índice normal de términos se verificó con
  `explain`, y tres consultas españolas recuperaron publicaciones aprobadas en el
  índice Atlas existente. El informe local está en `reports/freedict/verification.json`.

Los datos adaptados se pueden regenerar con los comandos anteriores y su versión
queda fijada por la URL y el hash del importador.
