require('dotenv').config();
const mongoose = require('mongoose');
const Wallpaper = require('../src/models/Wallpaper'); // Ajusta la ruta si es diferente

async function findGirlWallpapers() {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('✅ Conectado a MongoDB...');

        const wallpapers = await Wallpaper.find({ tags: 'girl' }).lean();

        console.log(`\n🔍 Encontrados ${wallpapers.length} wallpapers con la etiqueta "girl":\n`);
        wallpapers.forEach((w, index) => {
            console.log(`${index + 1}. ID: ${w._id}`);
            console.log(`   Imagen: ${w.imageUrl}`);
            console.log(`   Otras etiquetas: [${w.tags.filter(t => t !== 'girl').join(', ')}]`);
            console.log('--------------------------------------------------');
        });

        process.exit(0);
    } catch (err) {
        console.error('❌ Error:', err);
        process.exit(1);
    }
}

findGirlWallpapers();
