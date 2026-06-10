require('dotenv').config();
const mongoose = require('mongoose');
const Wallpaper = require('../src/models/Wallpaper');

async function migrateTags() {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('✅ Conectado a MongoDB...');

        // Buscar todos los wallpapers que tengan la etiqueta 'girl'
        const wallpapers = await Wallpaper.find({ tags: 'girl' });
        console.log(`📊 Total de wallpapers con etiqueta "girl" encontrados: ${wallpapers.length}`);

        let stats = {
            totalProcessed: wallpapers.length,
            animeGirl: 0,
            cyberpunkGirl: 0,
            gamingGirl: 0,
            noChange: 0,
            modified: 0
        };

        for (const wall of wallpapers) {
            let isModified = false;
            const tags = wall.tags.map(t => t.trim().toLowerCase());

            // 1. ANIME + GIRL -> ANIME GIRL
            if (tags.includes('anime') && tags.includes('girl')) {
                // Quitar 'girl'
                wall.tags = wall.tags.filter(t => t.toLowerCase().trim() !== 'girl');
                // Añadir 'anime girl' si no existe
                if (!wall.tags.some(t => t.toLowerCase().trim() === 'anime girl')) {
                    wall.tags.push('anime girl');
                }
                isModified = true;
                stats.animeGirl++;
            }
            // 2. CYBERPUNK + GIRL -> CYBERPUNK GIRL
            else if (tags.includes('cyberpunk') && tags.includes('girl')) {
                wall.tags = wall.tags.filter(t => t.toLowerCase().trim() !== 'girl');
                if (!wall.tags.some(t => t.toLowerCase().trim() === 'cyberpunk girl')) {
                    wall.tags.push('cyberpunk girl');
                }
                isModified = true;
                stats.cyberpunkGirl++;
            }
            // 3. GAMING + GIRL -> GAMING GIRL
            else if (tags.includes('gaming') && tags.includes('girl')) {
                wall.tags = wall.tags.filter(t => t.toLowerCase().trim() !== 'girl');
                if (!wall.tags.some(t => t.toLowerCase().trim() === 'gaming girl')) {
                    wall.tags.push('gaming girl');
                }
                isModified = true;
                stats.gamingGirl++;
            }
            else {
                stats.noChange++;
            }

            if (isModified) {
                // Guardar los cambios en la base de datos
                await wall.save();
                stats.modified++;
            }
        }

        // Obtener el conteo final de wallpapers que todavía tienen 'girl'
        const remainingCount = await Wallpaper.countDocuments({ tags: 'girl' });

        console.log('\n=========================================');
        console.log('🚀 REPORTE DE MIGRACIÓN DE ETIQUETAS "GIRL":');
        console.log('=========================================');
        console.log(`- Total procesados:                 ${stats.totalProcessed}`);
        console.log(`- Cambiados a "anime girl":        ${stats.animeGirl}`);
        console.log(`- Cambiados a "cyberpunk girl":    ${stats.cyberpunkGirl}`);
        console.log(`- Cambiados a "gaming girl":       ${stats.gamingGirl}`);
        console.log(`- Wallpapers modificados:           ${stats.modified}`);
        console.log(`- Wallpapers sin cambios:           ${stats.noChange}`);
        console.log('-----------------------------------------');
        console.log(`- Wallpapers restantes con "girl":  ${remainingCount}`);
        console.log('=========================================\n');

        process.exit(0);
    } catch (err) {
        console.error('❌ Error durante la migración:', err);
        process.exit(1);
    }
}

migrateTags();
