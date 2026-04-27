require('dotenv').config();
const mongoose = require('mongoose');
const Wallpaper = require('../src/models/Wallpaper'); // Ajusta la ruta

const removeLowUsageTags = async () => {
    try {
        console.log('📡 Conectando a MongoDB para limpieza masiva...');
        await mongoose.connect(process.env.MONGO_URI);
        console.log('✅ Conexión establecida.\n');

        // 1. Encontrar etiquetas con uso menor o igual a 2
        console.log('🔍 Analizando frecuencia de etiquetas...');
        const tagStats = await Wallpaper.aggregate([
            { $unwind: "$tags" },
            { 
                $group: { 
                    _id: "$tags", 
                    count: { $sum: 1 } 
                } 
            },
            { $match: { count: { $lte: 1 } } } // 👈 FILTRO: 1 o 2 usos solamente
        ]);

        const tagsToDelete = tagStats.map(t => t._id);

        if (tagsToDelete.length === 0) {
            console.log('✨ No se encontraron etiquetas con bajo uso. Todo limpio.');
            process.exit(0);
        }

        console.log(`🗑️ Se han detectado ${tagsToDelete.length} etiquetas "basura" o poco frecuentes.`);
        console.log(`🔧 Iniciando eliminación en la colección de Wallpapers...`);

        // 2. Eliminar esas etiquetas de todos los wallpapers
        // Usamos $pull para quitarlas del array sin borrar el wallpaper
        const result = await Wallpaper.updateMany(
            { tags: { $in: tagsToDelete } },
            { $pull: { tags: { $in: tagsToDelete } } }
        );

        console.log(`\n=========================================`);
        console.log(`✅ LIMPIEZA FINALIZADA`);
        console.log(`=========================================`);s
        console.log(`🏷️  Etiquetas eliminadas:  ${tagsToDelete.length}`);
        console.log(`🖼️  Wallpapers afectados:  ${result.modifiedCount}`);
        console.log(`🎯 Resultado: Tu base de datos ahora es mucho más pura.`);
        console.log(`=========================================`);

        process.exit(0);
    } catch (error) {
        console.error('❌ Error crítico en la limpieza:', error);
        process.exit(1);
    }
};

removeLowUsageTags();