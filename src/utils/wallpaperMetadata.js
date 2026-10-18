const METADATA_FIELDS = ['subjects', 'styles', 'colors', 'environments', 'characters', 'franchises', 'extraTags'];
const FIELD_NAMES = { subjects: 'sujetos', styles: 'estilos', colors: 'colores', environments: 'ambientes', characters: 'personajes', franchises: 'series o franquicias', extraTags: 'etiquetas adicionales' };
const SPANISH_FIELDS = { sujetos: 'subjects', estilos: 'styles', colores: 'colors', ambientes: 'environments', personajes: 'characters', franquicias: 'franchises', series: 'franchises', etiquetasAdicionales: 'extraTags' };
// Explicit equivalents only: free tags are never guessed into a category.
const ALIASES = {
    styles: { anime: [], cartoon: ['caricatura'], cyberpunk: [], fantasy: ['fantasia'], 'sci-fi': ['ciencia ficcion', 'sci fi', 'scifi', 'science fiction'], abstract: ['abstracto'], minimalist: ['minimalista', 'minimalism', 'minimalismo'], gaming: ['videojuegos'], 'pixel art': ['pixelart'], illustration: ['ilustracion'], photography: ['fotografia'], '3d': [], motivational: ['motivacional'], typography: ['tipografia'] },
    colors: { blue: ['azul'], red: ['rojo'], green: ['verde'], purple: ['morado', 'violeta'], pink: ['rosa', 'rosado'], yellow: ['amarillo'], orange: ['naranja'], black: ['negro'], white: ['blanco'], gray: ['gris', 'grey'], brown: ['marron', 'cafe'], gold: ['dorado'], turquoise: ['turquesa'] },
    subjects: { city: ['ciudad'], car: ['coche', 'auto', 'carro'], girl: ['chica'], boy: ['chico'], animal: [], dog: ['perro'], cat: ['gato'], dragon: [], robot: [], planet: ['planeta'], spaceship: ['nave espacial'], flower: ['flor', 'flores', 'flowers'], astronaut: ['astronauta'] },
    environments: { night: ['noche'], day: ['dia'], rain: ['lluvia'], snow: ['nieve'], sunset: ['atardecer'], forest: ['bosque'], ocean: ['oceano', 'mar'], mountain: ['montana'], desert: ['desierto'], space: ['espacio'], beach: ['playa'], street: ['calle'] },
};

function metadataError(message) {
    return Object.assign(new Error(message), { statusCode: 400 });
}

function normalizeTerm(value) {
    return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().replace(/^#+/, '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function canonicalTerm(field, value) {
    const term = normalizeTerm(value);
    const entry = Object.entries(ALIASES[field] || {}).find(([canonical, aliases]) => canonical === term || aliases.includes(term));
    return entry ? entry[0] : term;
}

function resolveMetadataAlias(value) {
    const term = normalizeTerm(value);
    for (const dictionary of Object.values(ALIASES)) {
        const entry = Object.entries(dictionary).find(([canonical, aliases]) => canonical === term || aliases.includes(term));
        if (entry) { return entry[0]; }
    }
    return undefined;
}

function normalizeMetadata(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
        throw metadataError('Los metadatos deben ser un objeto con listas de texto.');
    }
    const result = {};
    for (const [inputKey, values] of Object.entries(input)) {
        const field = SPANISH_FIELDS[inputKey] || inputKey;
        if (!METADATA_FIELDS.includes(field) || Object.hasOwn(result, field)) {
            throw metadataError(`Campo de metadatos no válido: ${inputKey}.`);
        }
        const limit = field === 'extraTags' ? 20 : 8;
        if (!Array.isArray(values) || values.length > limit || values.some(value => typeof value !== 'string' || value.length > 80 || /[\x00-\x1f]/.test(value))) {
            throw metadataError(`Usa hasta ${limit} valores de texto de 80 caracteres en ${FIELD_NAMES[field]}.`);
        }
        result[field] = [...new Set(values.map(value => canonicalTerm(field, value)).filter(Boolean))];
    }
    return result;
}

function parseMetadata(value) {
    if (typeof value !== 'string') { return normalizeMetadata(value); }
    if (value.length > 16000) { throw metadataError('Los metadatos son demasiado largos.'); }
    try { return normalizeMetadata(JSON.parse(value)); }
    catch (error) { throw error.statusCode ? error : metadataError('El JSON de metadatos no es válido.'); }
}

function effectiveMetadata(image, general = {}) {
    return { ...(image.aiMetadata || {}), ...general, ...(image.metadata || {}) };
}

function metadataTags(metadata) {
    return METADATA_FIELDS.flatMap(field => (metadata?.[field] || []).map(value => canonicalTerm(field, value)));
}

function searchTagsFor(wallpaper) {
    const manual = wallpaper.manualTags ?? wallpaper.tags ?? [];
    const metadataTerms = wallpaper.images?.length
        ? wallpaper.images.flatMap(image => metadataTags(effectiveMetadata(image, wallpaper.metadata)))
        : metadataTags(wallpaper.metadata);
    return [...new Set([...manual, ...metadataTerms].map(value => resolveMetadataAlias(value) ?? value))];
}

function matchedAssetId(wallpaper, query) {
    const words = normalizeTerm(resolveMetadataAlias(query) ?? query).split(/\s+/).filter(Boolean).map(word => resolveMetadataAlias(word) ?? word);
    return wallpaper.images?.find(image => image.assetId && words.every(word => {
        const terms = metadataTags(effectiveMetadata(image, wallpaper.metadata)).flatMap(term => normalizeTerm(term).split(/\s+/));
        return terms.includes(word);
    }))?.assetId;
}

function removeMetadataTag(wallpaper, tag) {
    const removeFrom = (metadata = {}) => Object.fromEntries(Object.entries(metadata).map(([field, values]) => [field,
        values.filter(value => canonicalTerm(field, value) !== canonicalTerm(field, tag)),
    ]));
    return { manualTags: (wallpaper.manualTags ?? wallpaper.tags ?? []).filter(value => (resolveMetadataAlias(value) ?? normalizeTerm(value)) !== (resolveMetadataAlias(tag) ?? normalizeTerm(tag))),
        metadata: removeFrom(wallpaper.metadata), images: (wallpaper.images || []).map(image => ({ ...image,
            metadata: removeFrom(image.metadata), aiMetadata: removeFrom(image.aiMetadata),
        })),
    };
}

function parseAssetMetadata(value, count) {
    if (value === undefined) { return Array.from({ length: count }, () => ({})); }
    let parsed = value;
    if (typeof value === 'string') {
        if (value.length > 160000) { throw metadataError('Los datos de las imágenes son demasiado largos.'); }
        try { parsed = JSON.parse(value); } catch { throw metadataError('Los metadatos de imágenes no son JSON válido.'); }
    }
    if (!Array.isArray(parsed) || parsed.length !== count) {
        throw metadataError('Envía un objeto de metadatos por cada archivo, en el mismo orden.');
    }
    return parsed.map(normalizeMetadata);
}

module.exports = { METADATA_FIELDS, ALIASES, normalizeTerm, normalizeMetadata, parseMetadata, parseAssetMetadata, effectiveMetadata, metadataTags, searchTagsFor, matchedAssetId, removeMetadataTag, metadataError, resolveMetadataAlias };
