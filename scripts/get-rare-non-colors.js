require('dotenv').config();
const mongoose = require('mongoose');
const Wallpaper = require('../src/models/Wallpaper');

// A list of common colors in English and Spanish to exclude
const COLORS = new Set([
    // English
    'red', 'green', 'blue', 'yellow', 'black', 'white', 'orange', 'purple', 'pink', 'brown', 'gray', 'grey',
    'silver', 'gold', 'violet', 'indigo', 'teal', 'cyan', 'magenta', 'beige', 'turquoise', 'navy', 'maroon',
    'olive', 'lime', 'bronze', 'lavender', 'peach', 'coral', 'mint', 'cream', 'neon', 'pastel', 'crimson',
    'lilac', 'mustard', 'khaki', 'mauve', 'charcoal', 'ivory', 'aqua', 'fuchsia', 'plum', 'rose', 'amber',
    'emerald', 'sapphire', 'ruby', 'dark blue', 'light blue', 'sky blue',
    // Spanish
    'rojo', 'verde', 'azul', 'amarillo', 'negro', 'blanco', 'naranja', 'morado', 'rosa', 'rosado', 'marrón',
    'marron', 'gris', 'plata', 'plateado', 'oro', 'dorado', 'violeta', 'índigo', 'indigo', 'turquesa', 'beis',
    'beige', 'púrpura', 'purpura', 'magenta', 'cian', 'lila', 'celeste', 'esmeralda', 'bronce', 'crema',
    'neón', 'carmesí', 'mostaza', 'caqui', 'marfil', 'fucsia', 'plomo', 'ámbar', 'ambar', 'zafiro', 'rubí',
    'rubi', 'azul oscuro', 'azul claro'
]);

async function run() {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('✅ Connected to MongoDB');

        // Aggregate tags to count their usage
        const tagCounts = await Wallpaper.aggregate([
            { $unwind: '$tags' },
            { $group: { _id: '$tags', count: { $sum: 1 } } },
            { $sort: { count: -1 } }
        ]);

        console.log(`Total unique tags found: ${tagCounts.length}`);

        const results = [];

        for (const item of tagCounts) {
            const tag = item._id.trim().toLowerCase();
            const count = item.count;

            if (COLORS.has(tag)) {
                continue;
            }

            if (count < 20) {
                results.push({ tag: item._id, count });
            }
        }

        // Sort results alphabetically by tag
        results.sort((a, b) => a.tag.localeCompare(b.tag));

        // Format and save to artifacts directory
        const fs = require('fs');
        const path = require('path');
        const artifactDir = 'C:\\Users\\Jefferson\\.gemini\\antigravity\\brain\\70200b98-6648-4126-9cf6-d625bba48a9f';
        const outputPath = path.join(artifactDir, 'rare_tags.md');

        let mdContent = `# Rare Tags (Non-Colors, Count < 20)\n\n`;
        mdContent += `Total: ${results.length} tags\n\n`;
        mdContent += `| Tag | Count |\n| --- | --- |\n`;
        for (const r of results) {
            mdContent += `| ${r.tag} | ${r.count} |\n`;
        }

        fs.writeFileSync(outputPath, mdContent, 'utf8');
        console.log(`Saved list of ${results.length} rare tags to: ${outputPath}`);

        mongoose.connection.close();
    } catch (err) {
        console.error('Error running script:', err);
        process.exit(1);
    }
}

run();
