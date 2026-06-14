require('dotenv').config();
const mongoose = require('mongoose');
const Wallpaper = require('../src/models/Wallpaper');
const TagMap = require('../src/models/TagMap');
const TagSuggestion = require('../src/models/TagSuggestion');

async function findCyberpunkTags() {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('✅ Conectado a MongoDB...');

        // 1. Buscar en Wallpapers
        const wallpapers = await Wallpaper.find({ tags: { $regex: /cyberpunk|2077/i } }).lean();
        const wpTags = new Set();
        wallpapers.forEach(w => {
            w.tags.forEach(t => {
                if (/cyberpunk|2077/i.test(t)) {
                    wpTags.add(t);
                }
            });
        });
        console.log('\n--- Etiquetas encontradas en Wallpapers ---');
        console.log(Array.from(wpTags));

        // 2. Buscar en TagMaps
        const tagMaps = await TagMap.find({
            $or: [
                { original: { $regex: /cyberpunk|2077/i } },
                { canonical: { $regex: /cyberpunk|2077/i } }
            ]
        }).lean();
        console.log('\n--- Registros encontrados en TagMap ---');
        tagMaps.forEach(m => {
            console.log(`  ${m.original} -> ${m.canonical}`);
        });

        // 3. Buscar en TagSuggestions
        const suggestions = await TagSuggestion.find({ tag: { $regex: /cyberpunk|2077/i } }).lean();
        console.log('\n--- Sugerencias encontradas en TagSuggestion ---');
        suggestions.forEach(s => {
            console.log(`  ${s.tag} (count: ${s.count})`);
        });

        process.exit(0);
    } catch (err) {
        console.error('❌ Error:', err);
        process.exit(1);
    }
}

findCyberpunkTags();
