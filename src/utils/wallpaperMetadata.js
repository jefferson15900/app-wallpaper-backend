const METADATA_FIELDS = ['subjects', 'styles', 'colors', 'environments', 'characters', 'franchises', 'extraTags'];
const DESCRIPTION_FIELDS = ['description', 'descriptionEs', 'descriptionEn'];
const TEXT_FIELDS = [...DESCRIPTION_FIELDS, 'descriptionEnSource'];
const FIELD_NAMES = { subjects: 'sujetos', styles: 'estilos', colors: 'colores', environments: 'ambientes', characters: 'personajes', franchises: 'series o franquicias', extraTags: 'etiquetas adicionales' };
const SPANISH_FIELDS = { sujetos: 'subjects', estilos: 'styles', colores: 'colors', ambientes: 'environments', personajes: 'characters', franquicias: 'franchises', series: 'franchises', etiquetasAdicionales: 'extraTags', descripcion: 'description', descripción: 'description' };
// Explicit equivalents only: free tags are never guessed into a category.
const ALIASES = {
    styles: {
        anime: [], cartoon: ['caricatura', 'caricaturas', 'cartoons'],
        cyberpunk: ['ciberpunk'], fantasy: ['fantasia', 'fantasias'],
        'sci-fi': ['ciencia ficcion', 'sci fi', 'scifi', 'science fiction'],
        abstract: ['abstracto', 'abstracta', 'abstractos', 'abstractas', 'arte abstracto'],
        minimalist: ['minimalista', 'minimalistas', 'minimalism', 'minimalismo'], gaming: ['videojuegos', 'videojuego', 'video game', 'video games', 'videogame', 'videogames'],
        'pixel art': ['pixelart', 'arte pixelado', 'arte de pixeles'], illustration: ['ilustracion', 'ilustraciones', 'illustrations'],
        photography: ['fotografia', 'fotografias', 'fotografico', 'fotografica'], '3d': ['tridimensional', 'tres dimensiones', 'three dimensional'],
        motivational: ['motivacional', 'motivacion', 'motivation'], typography: ['tipografia', 'tipografico', 'tipografica'],
    },
    colors: {
        blue: ['azul', 'azules'], red: ['rojo', 'roja', 'rojos', 'rojas'], green: ['verde', 'verdes'],
        purple: ['morado', 'morada', 'morados', 'moradas', 'violeta', 'violetas', 'purpura'],
        pink: ['rosa', 'rosado', 'rosada', 'rosados', 'rosadas'], yellow: ['amarillo', 'amarilla', 'amarillos', 'amarillas'],
        orange: ['naranja', 'anaranjado', 'anaranjada', 'anaranjados', 'anaranjadas'],
        black: ['negro', 'negra', 'negros', 'negras'], white: ['blanco', 'blanca', 'blancos', 'blancas'],
        gray: ['gris', 'grises', 'grey'], brown: ['marron', 'marrones', 'cafe', 'castano', 'castana'],
        gold: ['dorado', 'dorada', 'dorados', 'doradas', 'golden', 'oro'], turquoise: ['turquesa', 'turquesas'],
    },
    subjects: {
        city: ['ciudad', 'ciudades', 'cities', 'metropoli', 'metropolis'],
        car: ['coche', 'coches', 'auto', 'autos', 'carro', 'carros', 'automovil', 'automoviles', 'cars'],
        girl: ['chica', 'chicas', 'muchacha', 'muchachas', 'girls'], boy: ['chico', 'chicos', 'muchacho', 'muchachos', 'boys'],
        man: ['hombre', 'hombres', 'varon', 'varones', 'men'], woman: ['mujer', 'mujeres', 'women'],
        animal: ['animales', 'animals'], dog: ['perro', 'perra', 'perros', 'perras', 'dogs'], cat: ['gato', 'gata', 'gatos', 'gatas', 'cats'],
        dragon: ['dragones', 'dragons'], robot: ['robots'], planet: ['planeta', 'planetas', 'planets'],
        spaceship: ['nave espacial', 'naves espaciales', 'spaceships', 'spacecraft', 'space ship', 'space ships'],
        flower: ['flor', 'flores', 'flowers'], astronaut: ['astronauta', 'astronautas', 'astronauts'],
    },
    environments: {
        night: ['noche', 'noches', 'nocturno', 'nocturna', 'nighttime', 'night time'], day: ['dia', 'dias', 'diurno', 'diurna', 'daytime', 'day time'],
        rain: ['lluvia', 'lluvias', 'lluvioso', 'lluviosa', 'rainy', 'raining'], snow: ['nieve', 'nevado', 'nevada', 'snowy', 'snowing'],
        sunset: ['atardecer', 'atardeceres', 'puesta de sol', 'puestas de sol', 'ocaso', 'sunsets'],
        forest: ['bosque', 'bosques', 'forests', 'woods', 'woodland'], ocean: ['oceano', 'oceanos', 'mar', 'mares', 'sea', 'oceans', 'seas'],
        mountain: ['montana', 'montanas', 'mountains'], desert: ['desierto', 'desiertos', 'deserts'],
        space: ['espacio', 'espacio exterior', 'outer space'], beach: ['playa', 'playas', 'beaches'], street: ['calle', 'calles', 'streets'],
    },
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
        if ((!METADATA_FIELDS.includes(field) && !TEXT_FIELDS.includes(field)) || Object.hasOwn(result, field)) {
            throw metadataError(`Campo de metadatos no válido: ${inputKey}.`);
        }
        if (TEXT_FIELDS.includes(field)) {
            if (typeof values !== 'string') { throw metadataError('La descripción debe ser texto.'); }
            const description = values.replace(/\s+/g, ' ').trim();
            if (description.length > 240 || /[\x00-\x1f]/.test(description)) {
                throw metadataError('Usa una descripción de hasta 240 caracteres.');
            }
            result[field] = description;
            continue;
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

function searchDescriptionsFor(wallpaper) {
    const metadata = wallpaper.images?.length
        ? wallpaper.images.map(image => effectiveMetadata(image, wallpaper.metadata)) : [wallpaper.metadata];
    return [...new Set(metadata.flatMap(value => DESCRIPTION_FIELDS.map(field => value?.[field])).filter(value => typeof value === 'string' && value.trim()))];
}

function matchedAssetId(wallpaper, query) {
    const tokenize = value => normalizeTerm(value).match(/[\p{L}\p{N}]+/gu) || [];
    const words = tokenize(resolveMetadataAlias(query) ?? query).map(word => resolveMetadataAlias(word) ?? word);
    return wallpaper.images?.find(image => image.assetId && words.every(word => {
        const metadata = effectiveMetadata(image, wallpaper.metadata);
        const terms = [...metadataTags(metadata), ...DESCRIPTION_FIELDS.map(field => metadata[field] || '')].flatMap(tokenize)
            .map(term => resolveMetadataAlias(term) ?? term);
        return terms.includes(word);
    }))?.assetId;
}

function removeMetadataTag(wallpaper, tag) {
    const removeFrom = (metadata = {}) => Object.fromEntries(Object.entries(metadata).map(([field, values]) => [field,
        TEXT_FIELDS.includes(field) ? values : values.filter(value => canonicalTerm(field, value) !== canonicalTerm(field, tag)),
    ]));
    return { manualTags: (wallpaper.manualTags ?? wallpaper.tags ?? []).filter(value => (resolveMetadataAlias(value) ?? normalizeTerm(value)) !== (resolveMetadataAlias(tag) ?? normalizeTerm(tag))),
        metadata: removeFrom(wallpaper.metadata), images: (wallpaper.images || []).map(image => ({ ...image,
            metadata: removeFrom(image.metadata), aiMetadata: removeFrom(image.aiMetadata),
        })),
    };
}

function addMetadataTag(wallpaper, { tagToAdd, field, assetId }) {
    if (!METADATA_FIELDS.includes(field) || typeof tagToAdd !== 'string' || !tagToAdd.trim()
        || /[,\n\r]/.test(tagToAdd) || (assetId !== undefined && (typeof assetId !== 'string' || !assetId))) {
        throw metadataError('Elige un campo válido y escribe un solo TAG de hasta 80 caracteres.');
    }
    const tag = normalizeMetadata({ [field]: [tagToAdd] })[field][0];
    if (!tag) throw metadataError('El TAG no puede estar vacío.');
    const images = wallpaper.images || [];
    if (assetId !== undefined && !images.some(image => image.assetId === assetId)) {
        throw metadataError('La imagen ya no pertenece a esta publicación. Vuelve a abrir el formulario.');
    }
    let added = false;
    const append = metadata => {
        const values = normalizeMetadata({ [field]: metadata?.[field] || [] })[field];
        if (!values.includes(tag)) { values.push(tag); added = true; }
        return normalizeMetadata({ [field]: values })[field];
    };
    const changes = {};
    if (assetId === undefined) {
        changes.metadata = { ...wallpaper.metadata, [field]: append(wallpaper.metadata) };
    }
    if (images.length) {
        changes.images = images.map(image => {
            if (assetId !== undefined && image.assetId !== assetId) return image;
            // Preserve the effective field before adding; an image override must not hide a publication TAG.
            const values = append(effectiveMetadata(image, wallpaper.metadata));
            return { ...image, metadata: { ...image.metadata, [field]: values } };
        });
    }
    if (!added) throw metadataError('Este campo ya contiene el TAG en el destino elegido.');
    return changes;
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

module.exports = { METADATA_FIELDS, ALIASES, normalizeTerm, normalizeMetadata, parseMetadata, parseAssetMetadata, effectiveMetadata, metadataTags, searchTagsFor, searchDescriptionsFor, matchedAssetId, removeMetadataTag, addMetadataTag, metadataError, resolveMetadataAlias };
