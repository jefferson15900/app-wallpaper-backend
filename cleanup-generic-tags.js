require('dotenv').config();
const mongoose = require('mongoose');
const Wallpaper = require('./src/models/Wallpaper'); // Ajusta la ruta a tu modelo

const TAGS_TO_REMOVE = [
    'digital art', 
    'digital illustration', 
    'arte digital', 
    'anime style', 
    'spider-man',
    'naranja'
];

const cleanupTags = async () => {
    try {
        // 1. Conexión a la DB
        await mongoose.connect(process.env.MONGO_URI);
        console.log('✅ Conectado a MongoDB para limpieza profunda...');

        // 2. Ejecutar la eliminación masiva
        // Buscamos cualquier wallpaper que tenga al menos una de estas etiquetas
        // y las extraemos del array 'tags'
        const result = await Wallpaper.updateMany(
            { tags: { $in: TAGS_TO_REMOVE } }, 
            { $pull: { tags: { $in: TAGS_TO_REMOVE } } }
        );

        console.log(`-----------------------------------------`);
        console.log(`📊 RESULTADO DE LA OPERACIÓN:`);
        console.log(`   - Obras que contenían estas etiquetas: ${result.matchedCount}`);
        console.log(`   - Obras limpiadas con éxito:           ${result.modifiedCount}`);
        console.log(`-----------------------------------------`);
        
        console.log('🧹 Etiquetas eliminadas:');
        TAGS_TO_REMOVE.forEach(tag => console.log(`   [-] ${tag}`));
        console.log(`\n✨ Tu base de datos ahora está más enfocada en contenido real.`);

        process.exit(0);
    } catch (error) {
        console.error('❌ Error durante la limpieza:', error);
        process.exit(1);
    }
};

cleanupTags();