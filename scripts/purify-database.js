require('dotenv').config();
const mongoose = require('mongoose');
const Wallpaper = require('../src/models/Wallpaper'); 
const { cleanTags } = require('../src/config/tags');

const purifyDatabase = async () => {
    try {
        // 1. Conexión a la base de datos
        console.log('📡 Conectando a MongoDB...');
        await mongoose.connect(process.env.MONGO_URI);
        console.log('✅ Conexión establecida.\n');

        // 2. Obtener todos los wallpapers
        const wallpapers = await Wallpaper.find({});
        console.log(`📦 Se encontraron ${wallpapers.length} obras para analizar.`);

        let updatedCount = 0;
        let tagsRemovedGlobal = 0;
        let startTimestamp = Date.now();

        // 3. Iterar sobre cada wallpaper
        for (let i = 0; i < wallpapers.length; i++) {
            const wall = wallpapers[i];
            const originalTags = [...wall.tags];

            // Aplicamos tu nueva lógica maestra de cleanTags
            // Nota: Permitimos hasta 30 tags en la purificación para no ser tan agresivos
            const purifiedTags = cleanTags(originalTags, { maxTags: 30 });

            // Solo guardamos si hubo cambios reales (comparando arrays como strings)
            if (JSON.stringify(originalTags) !== JSON.stringify(purifiedTags)) {
                const diff = originalTags.length - purifiedTags.length;
                tagsRemovedGlobal += diff > 0 ? diff : 0;

                wall.tags = purifiedTags;
                await wall.save();
                updatedCount++;
            }

            // Mostrar progreso cada 50 elementos
            if ((i + 1) % 50 === 0) {
                console.log(`--- Procesando: ${i + 1}/${wallpapers.length} obras analizadas...`);
            }
        }

        // 4. Reporte Final
        let duration = ((Date.now() - startTimestamp) / 1000).toFixed(2);

        console.log(`\n=========================================`);
        console.log(`✨ PURIFICACIÓN COMPLETADA ✨`);
        console.log(`=========================================`);
        console.log(`⏱️  Tiempo total:      ${duration} segundos`);
        console.log(`🖼️  Obras analizadas:  ${wallpapers.length}`);
        console.log(`🔧 Obras actualizadas: ${updatedCount}`);
        console.log(`🧹 Tags basura/duplicados eliminados: ${tagsRemovedGlobal}`);
        console.log(`🎯 Estado de la base de datos: OPTIMIZADO`);
        console.log(`=========================================\n`);

        process.exit(0);
    } catch (error) {
        console.error('❌ ERROR CRÍTICO DURANTE LA PURIFICACIÓN:');
        console.error(error);
        process.exit(1);
    }
};

// Ejecutar el script
purifyDatabase();