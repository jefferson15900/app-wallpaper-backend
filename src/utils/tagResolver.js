const TagMap = require('../models/TagMap');

/**
 * 🎯 RESOLVER TÉRMINO ÚNICO
 * Recibe una palabra y busca su traducción oficial en TagMap.
 */
const resolveToCanonical = async (word) => {
    if (!word) return '';
    const term = word.toLowerCase().trim();

    try {
        // 🚀 LA MAGIA: Buscamos en ambas columnas
        const mapping = await TagMap.findOne({
            $or: [
                { original: term },
                { canonical: term }
            ]
        }).lean();

        return {
            canonical: mapping?.canonical ?? term,
            category: mapping?.category ?? null
        };
    } catch (error) {
        return { canonical: term, category: null };
    }
};

/**
 * 🎯 RESOLVER ARRAY DE ETIQUETAS
 * Una sola query a la DB para todos los tags.
 */
const resolveTagsArray = async (tagsArray) => {
    if (!Array.isArray(tagsArray) || tagsArray.length === 0) return [];

    const terms = tagsArray
        .filter(t => t && typeof t === 'string')
        .map(t => t.toLowerCase().trim());

    try {
        // Una sola query trae todos los mapeos de golpe
        const mappings = await TagMap.find({ original: { $in: terms } })
            .select('original canonical')
            .lean();

        // Construimos un diccionario { original -> canonical }
        const dict = Object.fromEntries(
            mappings.map(m => [m.original, m.canonical])
        );

        // Resolvemos cada tag usando el diccionario, fallback al término original
        const resolved = terms.map(t => dict[t] ?? t);

        // Eliminamos duplicados que surjan tras la traducción
        return [...new Set(resolved)];
    } catch (error) {
        console.error("❌ Error en resolveTagsArray:", error);
        return [...new Set(tagsArray)]; // fallback seguro
    }
};

module.exports = { resolveToCanonical, resolveTagsArray };