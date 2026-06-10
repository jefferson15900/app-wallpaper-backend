require('dotenv').config();
const mongoose = require('mongoose');
const Wallpaper = require('../src/models/Wallpaper');

async function testSearch() {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('✅ Conectado a MongoDB...');

        const query = 'anime';

        // 1. Consulta estándar con MongoDB (.find)
        const standardResults = await Wallpaper.find({
            status: 'approved',
            tags: query
        }).select('_id tags imageUrl').lean();

        console.log(`\n🔍 [Consulta Estándar .find({ tags: '${query}' })]`);
        console.log(`   - Encontrados: ${standardResults.length} wallpapers`);
        console.log('   - IDs de los primeros 10:');
        standardResults.slice(0, 10).forEach(w => {
            console.log(`     * ID: ${w._id} | Tags: [${w.tags.join(', ')}]`);
        });

        // 2. Consulta con Atlas Search (reproduciendo el pipeline del controlador)
        const pipeline = [
            {
                $search: {
                    index: "default",
                    compound: {
                        should: [
                            { text: { query: query, path: "tags" } }
                        ],
                        minimumShouldMatch: 1
                    }
                }
            },
            { $addFields: { score: { $meta: 'searchScore' } } },
            { $match: { status: 'approved' } },
            { $lookup: { from: 'users', localField: 'artist', foreignField: '_id', as: 'artist' } },
            { $unwind: '$artist' },
            { $match: { 'artist.isActive': { $ne: false } } }
        ];

        let atlasResults = [];
        try {
            atlasResults = await Wallpaper.aggregate(pipeline);
            console.log(`\n🔍 [Consulta con Atlas Search]`);
            console.log(`   - Encontrados: ${atlasResults.length} wallpapers`);
            console.log('   - IDs de los primeros 10:');
            atlasResults.slice(0, 10).forEach(w => {
                console.log(`     * ID: ${w._id} | Tags: [${w.tags.join(', ')}] | Score: ${w.score}`);
            });
        } catch (searchErr) {
            console.error('\n❌ Error al ejecutar Atlas Search:', searchErr.message);
        }

        // 3. Buscar diferencias: qué IDs están en Standard pero NO en Atlas Search
        if (standardResults.length > 0 && atlasResults.length > 0) {
            const atlasIds = new Set(atlasResults.map(w => w._id.toString()));
            const missing = standardResults.filter(w => !atlasIds.has(w._id.toString()));

            console.log(`\n⚠️ Diferencias:`);
            console.log(`   - Hay ${missing.length} wallpapers que tienen el tag '${query}' en BD, pero NO fueron devueltos por Atlas Search.`);
            if (missing.length > 0) {
                console.log('   - Primeros 5 wallpapers faltantes en Atlas Search:');
                missing.slice(0, 5).forEach(w => {
                    console.log(`     * ID: ${w._id} | Imagen: ${w.imageUrl} | Tags: [${w.tags.join(', ')}]`);
                });
            }
        }

        process.exit(0);
    } catch (err) {
        console.error('❌ Error general:', err);
        process.exit(1);
    }
}

testSearch();
