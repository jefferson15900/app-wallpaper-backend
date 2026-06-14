require('dotenv').config();
const mongoose = require('mongoose');
const Wallpaper = require('../src/models/Wallpaper');
const TagMap = require('../src/models/TagMap');
const TagSuggestion = require('../src/models/TagSuggestion');

async function migrateSpidermanTags() {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('✅ Conectado a MongoDB...');

        let stats = {
            wallpapersProcessed: 0,
            wallpapersModified: 0,
            tagMapsProcessed: 0,
            tagMapsModified: 0,
            tagMapsDeleted: 0,
            tagSuggestionsProcessed: 0,
            tagSuggestionsModified: 0,
            tagSuggestionsDeleted: 0
        };

        // 1. MIGRACIÓN EN WALLPAPERS
        console.log('\n--- 1. Procesando Wallpapers ---');
        // Buscar wallpapers que contengan la etiqueta "spider-man" (caso insensible)
        const wallpapers = await Wallpaper.find({ tags: { $regex: /^spider-man$/i } });
        stats.wallpapersProcessed = wallpapers.length;
        console.log(`Encontrados ${wallpapers.length} wallpapers con etiquetas "spider-man".`);

        for (const wall of wallpapers) {
            let isModified = false;
            // Remover todas las variaciones de 'spider-man'
            const cleanTags = wall.tags.filter(t => t.trim().toLowerCase() !== 'spider-man');
            
            if (cleanTags.length !== wall.tags.length) {
                isModified = true;
                // Añadir 'spiderman' si no existe ya en la lista limpia
                const hasSpiderman = cleanTags.some(t => t.trim().toLowerCase() === 'spiderman');
                if (!hasSpiderman) {
                    cleanTags.push('spiderman');
                }
                wall.tags = cleanTags;
            }

            if (isModified) {
                await wall.save();
                stats.wallpapersModified++;
            }
        }
        console.log(`Wallpapers modificados: ${stats.wallpapersModified}`);

        // 2. MIGRACIÓN EN TAGMAPS
        console.log('\n--- 2. Procesando Mappings de Etiquetas (TagMap) ---');
        const tagMaps = await TagMap.find({
            $or: [
                { original: { $regex: /^spider-man$/i } },
                { canonical: { $regex: /^spider-man$/i } }
            ]
        });
        stats.tagMapsProcessed = tagMaps.length;
        console.log(`Encontrados ${tagMaps.length} registros en TagMap.`);

        for (const map of tagMaps) {
            let originalMatch = map.original.toLowerCase().trim() === 'spider-man';
            let canonicalMatch = map.canonical.toLowerCase().trim() === 'spider-man';

            if (originalMatch || canonicalMatch) {
                let targetOriginal = originalMatch ? 'spiderman' : map.original;
                let targetCanonical = canonicalMatch ? 'spiderman' : map.canonical;

                // Como 'original' tiene un índice único en el esquema, comprobamos si ya existe el nuevo mapeo
                const existing = await TagMap.findOne({ original: targetOriginal });
                if (existing) {
                    // Si ya existe un mapeo con el original destino, eliminamos este duplicado redundante
                    if (existing.canonical === targetCanonical) {
                        await TagMap.deleteOne({ _id: map._id });
                        stats.tagMapsDeleted++;
                        console.log(`[-] TagMap duplicado eliminado: ${map.original} -> ${map.canonical}`);
                    } else {
                        // Si difiere la canonical, actualizamos la canonical del existente o eliminamos
                        console.log(`[!] Conflicto detectado en TagMap: ${targetOriginal} ya apunta a ${existing.canonical}, no se puede remapear ${map.original} -> ${targetCanonical}`);
                        await TagMap.deleteOne({ _id: map._id });
                        stats.tagMapsDeleted++;
                    }
                } else {
                    map.original = targetOriginal;
                    map.canonical = targetCanonical;
                    await map.save();
                    stats.tagMapsModified++;
                    console.log(`[~] TagMap actualizado: ${map.original} -> ${map.canonical}`);
                }
            }
        }

        // 3. MIGRACIÓN EN TAGSUGGESTIONS
        console.log('\n--- 3. Procesando Sugerencias de Etiquetas (TagSuggestion) ---');
        const tagSuggestions = await TagSuggestion.find({ tag: { $regex: /^spider-man$/i } });
        stats.tagSuggestionsProcessed = tagSuggestions.length;
        console.log(`Encontrados ${tagSuggestions.length} registros en TagSuggestion.`);

        for (const sug of tagSuggestions) {
            // Buscamos si ya existe una sugerencia para "spiderman"
            const spidermanSug = await TagSuggestion.findOne({ tag: 'spiderman' });
            if (spidermanSug) {
                // Si existe, le sumamos el conteo y eliminamos la sugerencia vieja
                spidermanSug.count += sug.count;
                await spidermanSug.save();
                await TagSuggestion.deleteOne({ _id: sug._id });
                stats.tagSuggestionsDeleted++;
                console.log(`[-] TagSuggestion de "spider-man" fusionada con "spiderman" (Nuevo count: ${spidermanSug.count})`);
            } else {
                // Si no existe, simplemente renombramos
                sug.tag = 'spiderman';
                await sug.save();
                stats.tagSuggestionsModified++;
                console.log(`[~] TagSuggestion renombrada a "spiderman"`);
            }
        }

        console.log('\n=========================================');
        console.log('🚀 REPORTE DE MIGRACIÓN SPIDER-MAN -> SPIDERMAN:');
        console.log('=========================================');
        console.log(`- Wallpapers procesados:            ${stats.wallpapersProcessed}`);
        console.log(`- Wallpapers modificados:           ${stats.wallpapersModified}`);
        console.log(`- TagMaps procesados:               ${stats.tagMapsProcessed}`);
        console.log(`- TagMaps modificados:              ${stats.tagMapsModified}`);
        console.log(`- TagMaps eliminados/fusionados:    ${stats.tagMapsDeleted}`);
        console.log(`- TagSuggestions procesados:        ${stats.tagSuggestionsProcessed}`);
        console.log(`- TagSuggestions modificadas:       ${stats.tagSuggestionsModified}`);
        console.log(`- TagSuggestions eliminadas:        ${stats.tagSuggestionsDeleted}`);
        console.log('=========================================\n');

        process.exit(0);
    } catch (err) {
        console.error('❌ Error durante la migración:', err);
        process.exit(1);
    }
}

migrateSpidermanTags();
