require('dotenv').config();
const mongoose = require('mongoose');
const Wallpaper = require('../src/models/Wallpaper');
const TagMap = require('../src/models/TagMap');
const TagSuggestion = require('../src/models/TagSuggestion');

async function migrateCyberpunkTags() {
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

        const targetRegex = /^cyberpunk[- ]?2077$/i;
        const canonicalTag = 'cyberpunk';

        // 1. MIGRACIÓN EN WALLPAPERS
        console.log('\n--- 1. Procesando Wallpapers ---');
        // Buscar wallpapers que contengan la etiqueta "cyberpunk 2077" (o similar)
        const wallpapers = await Wallpaper.find({ tags: { $regex: targetRegex } });
        stats.wallpapersProcessed = wallpapers.length;
        console.log(`Encontrados ${wallpapers.length} wallpapers con etiquetas de "cyberpunk 2077".`);

        for (const wall of wallpapers) {
            let isModified = false;
            // Remover todas las variaciones de 'cyberpunk 2077'
            const cleanTags = wall.tags.filter(t => !targetRegex.test(t.trim()));
            
            if (cleanTags.length !== wall.tags.length) {
                isModified = true;
                // Añadir 'cyberpunk' si no existe ya en la lista limpia
                const hasCanonical = cleanTags.some(t => t.trim().toLowerCase() === canonicalTag);
                if (!hasCanonical) {
                    cleanTags.push(canonicalTag);
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
                { original: { $regex: targetRegex } },
                { canonical: { $regex: targetRegex } }
            ]
        });
        stats.tagMapsProcessed = tagMaps.length;
        console.log(`Encontrados ${tagMaps.length} registros en TagMap.`);

        for (const map of tagMaps) {
            let originalMatch = targetRegex.test(map.original);
            let canonicalMatch = targetRegex.test(map.canonical);

            if (originalMatch || canonicalMatch) {
                let targetOriginal = originalMatch ? canonicalTag : map.original;
                let targetCanonical = canonicalMatch ? canonicalTag : map.canonical;

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
        const tagSuggestions = await TagSuggestion.find({ tag: { $regex: targetRegex } });
        stats.tagSuggestionsProcessed = tagSuggestions.length;
        console.log(`Encontrados ${tagSuggestions.length} registros en TagSuggestion.`);

        for (const sug of tagSuggestions) {
            // Buscamos si ya existe una sugerencia para "cyberpunk"
            const canonicalSug = await TagSuggestion.findOne({ tag: canonicalTag });
            if (canonicalSug) {
                // Si existe, le sumamos el conteo y eliminamos la sugerencia vieja
                canonicalSug.count += sug.count;
                await canonicalSug.save();
                await TagSuggestion.deleteOne({ _id: sug._id });
                stats.tagSuggestionsDeleted++;
                console.log(`[-] TagSuggestion de "${sug.tag}" fusionada con "${canonicalTag}" (Nuevo count: ${canonicalSug.count})`);
            } else {
                // Si no existe, simplemente renombramos
                sug.tag = canonicalTag;
                await sug.save();
                stats.tagSuggestionsModified++;
                console.log(`[~] TagSuggestion renombrada a "${canonicalTag}"`);
            }
        }

        console.log('\n=========================================');
        console.log('🚀 REPORTE DE MIGRACIÓN CYBERPUNK 2077 -> CYBERPUNK:');
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

migrateCyberpunkTags();
