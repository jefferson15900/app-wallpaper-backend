require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('./src/config/db');
const Wallpaper = require('./src/models/Wallpaper');

const analyzeTagFormats = async () => {
    try {
        await connectDB();
        console.log("🔍 Analizando estado actual de tags...\n");

        const wallpapers = await Wallpaper.find({});

        let totalTags = 0;
        let sinTags = 0;
        let pocosTags = 0; // menos de 5
        let conSeparador = 0;
        let conParentesis = 0;
        let ejemplosSeparador = [];
        let ejemplosParentesis = [];
        let wallpapersSinTags = [];

        for (const wall of wallpapers) {
            const tags = wall.tags || [];

            if (tags.length === 0) {
                sinTags++;
                wallpapersSinTags.push(wall.title);
                continue;
            }

            if (tags.length < 5) pocosTags++;

            for (const tag of tags) {
                totalTags++;
                if (tag.includes(' / ') || tag.includes(' - ') || tag.includes(' – ')) {
                    conSeparador++;
                    if (ejemplosSeparador.length < 5) ejemplosSeparador.push(tag);
                }
                if (tag.match(/\(.+\)/)) {
                    conParentesis++;
                    if (ejemplosParentesis.length < 5) ejemplosParentesis.push(tag);
                }
            }
        }

        console.log(`📊 RESUMEN`);
        console.log(`═══════════════════════════════`);
        console.log(`Total wallpapers : ${wallpapers.length}`);
        console.log(`Total tags       : ${totalTags}`);
        console.log(`Promedio tags    : ${(totalTags / wallpapers.length).toFixed(1)} por wallpaper`);
        console.log(`\n⚠️  PROBLEMAS ENCONTRADOS`);
        console.log(`═══════════════════════════════`);
        console.log(`Sin tags         : ${sinTags}`);
        console.log(`Menos de 5 tags  : ${pocosTags}`);
        console.log(`Con separador    : ${conSeparador}`);
        console.log(`Con paréntesis   : ${conParentesis}`);

        if (ejemplosSeparador.length > 0) {
            console.log(`\n📌 Ejemplos con separador:`);
            ejemplosSeparador.forEach(e => console.log(`   → "${e}"`));
        }
        if (ejemplosParentesis.length > 0) {
            console.log(`\n📌 Ejemplos con paréntesis:`);
            ejemplosParentesis.forEach(e => console.log(`   → "${e}"`));
        }
        if (wallpapersSinTags.length > 0) {
            console.log(`\n📌 Wallpapers sin tags (${wallpapersSinTags.length}):`);
            wallpapersSinTags.slice(0, 10).forEach(t => console.log(`   → "${t}"`));
            if (wallpapersSinTags.length > 10) console.log(`   ... y ${wallpapersSinTags.length - 10} más`);
        }

        console.log(`\n✅ Análisis completado`);
        mongoose.connection.close();
        process.exit(0);

    } catch (err) {
        console.error("❌ Error:", err);
        process.exit(1);
    }
};

analyzeTagFormats();