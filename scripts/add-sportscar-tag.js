require('dotenv').config();
const mongoose = require('mongoose');
const Wallpaper = require('../src/models/Wallpaper');

async function addSportsCarTag() {
    try {
        console.log('🔌 Conectando a MongoDB...');
        await mongoose.connect(process.env.MONGO_URI);
        console.log('✅ Conectado con éxito.');

        console.log('🚀 Iniciando actualización de wallpapers...');
        const result = await Wallpaper.updateMany(
            { tags: "car" },
            { $addToSet: { tags: "sports car" } }
        );

        console.log(`✨ Proceso completado:`);
        console.log(`   - Wallpapers encontrados con etiqueta 'car': ${result.matchedCount}`);
        console.log(`   - Wallpapers actualizados (se les añadió 'sports car'): ${result.modifiedCount}`);

        process.exit(0);
    } catch (error) {
        console.error('❌ Error al actualizar los wallpapers:', error);
        process.exit(1);
    }
}

addSportsCarTag();
