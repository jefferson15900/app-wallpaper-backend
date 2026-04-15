require('dotenv').config();
const mongoose = require('mongoose');
const Wallpaper = require('./src/models/Wallpaper'); // Ajusta la ruta si es necesario

const removeOtrosTag = async () => {
    try {
        // 1. Conectar a la base de datos
        await mongoose.connect(process.env.MONGO_URI);
        console.log('✅ Conectado a MongoDB para limpieza...');

        // 2. Ejecutar la actualización masiva
        // $pull elimina el elemento específico de un array
        const result = await Wallpaper.updateMany(
            { tags: "otros" }, // Busca los que tengan esa etiqueta
            { $pull: { tags: "otros" } } // La quita del array
        );

        console.log(`-----------------------------------------`);
        console.log(`📊 RESULTADO DE LA LIMPIEZA:`);
        console.log(`   - Wallpapers analizados: ${result.matchedCount}`);
        console.log(`   - Wallpapers modificados: ${result.modifiedCount}`);
        console.log(`-----------------------------------------`);
        console.log('✨ Etiqueta "otros" eliminada con éxito.');

        process.exit(0);
    } catch (error) {
        console.error('❌ Error durante la limpieza:', error);
        process.exit(1);
    }
};

removeOtrosTag();