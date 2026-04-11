require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('./src/config/db');
const Wallpaper = require('./src/models/Wallpaper');

// Limpia UN tag y devuelve array de tags limpios
const expandTag = (tag) => {
    if (typeof tag !== 'string' || tag.length === 0) return [];

    let results = [];

    // CASO 1: Paréntesis — "anime semi-realista (semi-realistic anime)"
    // → ["anime semi-realista", "semi-realistic anime"]
    const parenMatch = tag.match(/^(.+?)\s*\((.+?)\)$/);
    if (parenMatch) {
        results.push(parenMatch[1].trim());
        results.push(parenMatch[2].trim());
    }
    // CASO 2: Slash o guión como separador — "azul - blue" / "coche / car"
    else if (tag.includes(' / ') || tag.includes(' - ') || tag.includes(' – ')) {
        results = tag.split(/\s*[\/\-–]\s*/).map(p => p.trim());
    }
    // CASO 3: Tag limpio — "dark", "anime"
    else {
        results.push(tag.trim());
    }

    return results
        .map(t => t.toLowerCase().trim())
        .filter(t => t.length > 1);
};

const migrateTags = async () => {
    try {
        await connectDB();
        console.log("🛰️  Iniciando limpieza de ADN...");

        const wallpapers = await Wallpaper.find({});
        console.log(`📊 Total: ${wallpapers.length} wallpapers\n`);

        let updatedCount = 0;

        for (let wall of wallpapers) {
            const originalTags = wall.tags || [];
            const expandedTags = [];

            for (const tag of originalTags) {
                expandedTags.push(...expandTag(tag));
            }

            // Deduplicar
            const cleanTags = [...new Set(expandedTags)];

            const changed = JSON.stringify(originalTags.map(t => t.toLowerCase().trim()).sort())
                         !== JSON.stringify(cleanTags.sort());

            if (changed) {
                wall.tags = cleanTags;
                await wall.save();
                updatedCount++;
                console.log(`✅ [${updatedCount}] "${wall.title}"`);
                console.log(`   Antes:   ${originalTags.slice(0, 2).join(' | ')}`);
                console.log(`   Después: ${cleanTags.slice(0, 4).join(' | ')}\n`);
            }
        }

        console.log(`✨ Limpieza completada!`);
        console.log(`📝 Corregidos: ${updatedCount} de ${wallpapers.length}`);

        mongoose.connection.close();
        process.exit(0);

    } catch (err) {
        console.error("❌ Error:", err);
        process.exit(1);
    }
};

migrateTags();