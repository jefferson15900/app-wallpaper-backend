const Wallpaper = require('../models/Wallpaper');
const TagSuggestion = require('../models/TagSuggestion');

exports.syncTagSuggestions = async () => {
    try {
        console.log('🔄 [TAGS] Iniciando sincronización...');

        const tagCounts = await Wallpaper.aggregate([
            { $match: { status: 'approved' } },
            { $unwind: '$tags' },
            { $group: { _id: '$tags', count: { $sum: 1 } } },
            { $project: { _id: 0, tag: '$_id', count: 1 } },
        ]);

        if (!tagCounts.length) {
            console.warn('⚠️ [TAGS] No hay tags aprobados — sync abortado.');
            return;
        }

        // Upsert de los tags activos
        const ops = tagCounts.map(({ tag, count }) => ({
            updateOne: {
                filter: { tag },
                update: { $set: { tag, count } },
                upsert: true,
            },
        }));

        await TagSuggestion.bulkWrite(ops, { ordered: false });

        // Eliminar tags que ya no tienen wallpapers aprobados
        const activeTags = tagCounts.map(t => t.tag);
        const { deletedCount } = await TagSuggestion.deleteMany({
            tag: { $nin: activeTags },
        });

        console.log(`✅ [TAGS] ${ops.length} sincronizados, ${deletedCount} eliminados.`);

    } catch (err) {
        console.error('❌ [TAGS] Error en sync:', err);
    }
};


// 📈 Suman +1 a las etiquetas de un solo wallpaper
exports.incrementTagCounts = async (tagsArray) => {
    if (!tagsArray?.length) return;

    try {
        const ops = tagsArray
            .filter(tag => typeof tag === 'string' && tag.trim().length > 0)
            .map(tag => ({
                updateOne: {
                    filter: { tag: tag.toLowerCase().trim() },
                    update: { $inc: { count: 1 } },
                    upsert: true,
                },
            }));

        if (!ops.length) return;

        await TagSuggestion.bulkWrite(ops, { ordered: false }); 
        console.log(`📈 [TAGS] Incrementados: ${ops.length} tags`);

    } catch (err) {
        console.error('❌ Error incrementando tags:', err); // err completo, no solo .message
    }
};