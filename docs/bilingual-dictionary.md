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

## Corrección ortográfica bilingüe

Antes de traducir una palabra desconocida, la búsqueda puede corregir una letra
omitida, añadida, sustituida o dos letras contiguas intercambiadas. También prueba
los candidatos de singular ya existentes: `adrillas` → `ardilla` → `squirrel`.
Cada concepto de la consulta sigue siendo obligatorio, por ejemplo el color en
`adrillas azules`. Las etiquetas almacenadas no cambian.

Se respetan las palabras exactas del diccionario, los alias revisados, las etiquetas
del catálogo y los tokens dentro de nombres o frases existentes. Solo se aplica una
corrección automática cuando hay una única interpretación candidata respaldada por
etiquetas de publicaciones aprobadas. Si varias interpretaciones tienen contenido,
se conserva la consulta y el endpoint de sugerencias ofrece opciones de «¿Quisiste
decir…?». Cada opción se verifica con la consulta completa, tipo de contenido,
aprobación y artista activo. La app móvil ya sabe mostrar y seleccionar ese formato.

El vocabulario se prepara en segundo plano después de conectar MongoDB. El índice
del diccionario se reutiliza durante 15 minutos; las etiquetas, sus frecuencias y
los alias aprendidos se actualizan al usarse después de 60 segundos. No se recorre
el diccionario completo por búsqueda. Un índice compacto de firmas de borrado y
búsqueda binaria recupera candidatas y comprueba la palabra completa, incluidas las
posibles colisiones de hash. No requiere otra colección ni servicios externos.

Límites conservadores: palabras de entrada de 4–32 letras latinas normalizadas,
hasta seis términos desconocidos y consultas de hasta 150 caracteres para activar
la corrección; una edición por palabra o candidato singular, máximo 40 candidatas
evaluadas por término y ocho sugerencias. Si un conjunto de firmas supera 4.000
palabras, se conserva la entrada original. El catálogo se limita a 20.000 etiquetas
y 50.000 alias; alcanzar esos límites desactiva la corrección hasta ajustar el
índice, evitando corregir nombres que quedaron fuera. Los errores de carga dejan
operativas las equivalencias y el comportamiento fuzzy existentes.

La paginación guarda las correcciones elegidas, incluso la ausencia de correcciones,
para mantener la misma interpretación al pedir más resultados. Los cursores se
invalidan al cambiar `SEARCH_VERSION` con este despliegue.

La comprobación local con el diccionario completo registró unos 13 MB adicionales
de memoria retenida entre heap y arrays, y verificó `rudeas` → `rueda` → `wheel`
contra una publicación aprobada del índice Atlas. Los tiempos de esa conexión de
prueba fueron aproximadamente 2,6 segundos con el índice frío y 0,25–0,42 segundos
para resolver consultas posteriores; incluyen los viajes a MongoDB y no son una
garantía de latencia de producción. Informe: `reports/freedict/spelling-verification.json`.

## Frases con atributos

La búsqueda interpreta `de color azul`, `con un color azul`, `blue color` y
`de estilo anime` usando los colores, estilos y alias de metadatos existentes.
Reconoce sus plurales y errores de una letra con una única interpretación dentro
del atributo. Conserva nombres revisados en TagMap, valores desconocidos y el
sustantivo `color` cuando aparece solo. No interpreta cualquier oración natural.
Las conjunciones `y/and` y los signos de puntuación dejan de crear condiciones
adicionales; todos los conceptos solicitados siguen siendo obligatorios.

Las sugerencias completan atributos pendientes como `carros de color az`,
respetando tipo de contenido, aprobación y artista activo. Las consultas admiten
hasta 150 caracteres sin caracteres de control. No requiere migrar datos,
descargar otro diccionario ni llamar a servicios de traducción.

Validación: 73 pruebas automatizadas aprobadas. El controlador local, conectado
en modo de solo lectura al índice Atlas real, devolvió exactamente los mismos
8 wallpapers para 19 variantes de `carros azules`, incluidas las frases que antes
devolvían cero. Informe local: `reports/freedict/car-search-audit-after.json`.
Estos cambios necesitan desplegar el backend para llegar a la app publicada.
