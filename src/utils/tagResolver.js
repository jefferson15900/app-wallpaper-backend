const TagMap = require('../models/TagMap');
const { SYNONYMS } = require('../config/tags');

/**
 * 🎯 RESOLVER TÉRMINO ÚNICO
 * Recibe una palabra y busca su traducción oficial o término canónico en SYNONYMS o TagMap.
 * Se usa principalmente en la barra de búsqueda.
 * 
 * @param {string} word - La palabra a traducir.
 * @returns {Promise<string>} - La palabra canónica o la original si no hay mapeo.
 */
const resolveToCanonical = async (word) => {
    if (!word) return '';
    const term = word.toLowerCase().trim();

    // 🚀 Optimización local: buscar primero en los sinónimos estáticos
    if (SYNONYMS && SYNONYMS[term]) {
        return SYNONYMS[term];
    }

    try {
        const mapping = await TagMap.findOne({ original: term }).lean();
        return mapping?.canonical ?? term;
    } catch (error) {
        console.error("❌ Error en resolveToCanonical:", error);
        return term;
    }
};

/**
 * 🎯 RESOLVER ARRAY DE ETIQUETAS
 * Traduce un grupo entero de etiquetas de un golpe.
 * Se usa principalmente al subir un wallpaper nuevo o al re-etiquetar por IA.
 * 
 * @param {string[]} tagsArray - Array de etiquetas a traducir.
 * @returns {Promise<string[]>} - Array de etiquetas normalizadas y sin duplicados.
 */
const resolveTagsArray = async (tagsArray) => {
    if (!Array.isArray(tagsArray) || tagsArray.length === 0) return [];

    // Limpiamos los strings de entrada y resolvemos contra los sinónimos estáticos
    const terms = tagsArray
        .filter(t => t && typeof t === 'string')
        .map(t => {
            const clean = t.toLowerCase().trim();
            return SYNONYMS[clean] ?? clean;
        });

    try {
        // 🚀 OPTIMIZACIÓN: Una sola consulta a la DB para todos los tags a la vez
        const mappings = await TagMap.find({ original: { $in: terms } })
            .select('original canonical')
            .lean();

        // Construimos un diccionario en memoria { original -> canonical }
        const dict = Object.fromEntries(
            mappings.map(m => [m.original, m.canonical])
        );

        // Resolvemos cada tag usando el diccionario. Si no existe, dejamos el término localmente resuelto.
        const resolved = terms.map(t => dict[t] ?? t);

        // Eliminamos duplicados que surjan tras la traducción con un Set
        return [...new Set(resolved)];
    } catch (error) {
        console.error("❌ Error en resolveTagsArray:", error);
        return [...new Set(terms)]; // Fallback seguro
    }
};

module.exports = { resolveToCanonical, resolveTagsArray };