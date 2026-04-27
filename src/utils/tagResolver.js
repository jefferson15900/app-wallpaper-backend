const TagMap = require('../models/TagMap');

/**
 * 🎯 RESOLVER TÉRMINO ÚNICO
 * Recibe una palabra y busca su traducción oficial en TagMap.
 */
const resolveToCanonical = async (word) => {
    // CORRECCIÓN: Devolvemos un objeto consistente incluso si no hay palabra
    if (!word) return { canonical: '', category: null };
    const term = word.toLowerCase().trim();

    try {
        // Buscamos en ambas columnas
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
        // 🚀 MEJORA: Búsqueda masiva inteligente en ambas columnas
        const mappings = await TagMap.find({
            $or: [
                { original: { $in: terms } },
                { canonical: { $in: terms } }
            ]
        }).select('original canonical').lean();

        // 🧠 DICCIONARIO INTELIGENTE:
        // Mapeamos tanto el original como el canonical hacia el canonical.
        // Esto cubre: "ciudad" -> "city" Y "city" -> "city".
        const dict = {};
        mappings.forEach(m => {
            dict[m.original] = m.canonical;
            dict[m.canonical] = m.canonical;
        });

        const resolved = terms.map(t => dict[t] ?? t);

        return [...new Set(resolved)];
    } catch (error) {
        console.error("❌ Error en resolveTagsArray:", error);
        return [...new Set(terms)]; 
    }
};

module.exports = { resolveToCanonical, resolveTagsArray };