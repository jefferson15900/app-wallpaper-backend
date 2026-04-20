require('dotenv').config();
const mongoose = require('mongoose');
const Wallpaper = require('../src/models/Wallpaper');
const { cleanTags } = require('../src/config/tags');

const BATCH_SIZE = 500; // Documentos por lote de escritura

const purifyDatabase = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('🚀 Conectado a MongoDB. Iniciando purificación masiva...');

        const wallpapers = await Wallpaper.find({}, '_id tags'); // ✅ Solo traemos los campos necesarios
        console.log(`📦 Analizando ${wallpapers.length} obras...`);

        let modifiedCount = 0;
        let totalTagsRemoved = 0;
        let bulkOps = []; // Acumulador de operaciones

        for (const wall of wallpapers) {
            const oldTags = [...wall.tags];
            const newTags = cleanTags(oldTags, { maxTags: 30 });

            if (JSON.stringify(oldTags) !== JSON.stringify(newTags)) {
                const diff = oldTags.length - newTags.length;
                totalTagsRemoved += diff > 0 ? diff : 0;
                modifiedCount++;

                // ✅ Acumulamos en lugar de guardar uno por uno
                bulkOps.push({
                    updateOne: {
                        filter: { _id: wall._id },
                        update: { $set: { tags: newTags } }
                    }
                });

                // ✅ Cuando el lote está lleno, ejecutamos y vaciamos
                if (bulkOps.length >= BATCH_SIZE) {
                    await Wallpaper.bulkWrite(bulkOps);
                    console.log(`--- Progresando: ${modifiedCount} obras normalizadas...`);
                    bulkOps = [];
                }
            }
        }

        // ✅ Ejecutar el lote final (los que quedaron sin llegar a BATCH_SIZE)
        if (bulkOps.length > 0) {
            await Wallpaper.bulkWrite(bulkOps);
        }

        console.log(`\n=========================================`);
        console.log(`✅ PURIFICACIÓN COMPLETADA`);
        console.log(`=========================================`);
        console.log(`🖼️  Obras revisadas:     ${wallpapers.length}`);
        console.log(`🔧 Obras actualizadas:   ${modifiedCount}`);
        console.log(`🧹 Etiquetas eliminadas: ${totalTagsRemoved}`);
        console.log(`✨ Sinónimos unificados con éxito.`);
        console.log(`=========================================\n`);

        process.exit(0);
    } catch (error) {
        console.error('❌ Error crítico en la purificación:', error);
        process.exit(1);
    }
};

purifyDatabase();