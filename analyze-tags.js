require('dotenv').config();
const mongoose = require('mongoose');
const Wallpaper = require('./src/models/Wallpaper'); // Ajusta la ruta si es necesario

const analyzeTags = async () => {
    try {
        // 1. Conexión a la DB
        await mongoose.connect(process.env.MONGO_URI);
        console.log('✅ Conectado a MongoDB. Analizando ADN de la galería...\n');

        // 2. Agregación de MongoDB para contar etiquetas
        const stats = await Wallpaper.aggregate([
            { $unwind: "$tags" }, // Desglosa los arrays de etiquetas
            { 
                $group: { 
                    _id: { $toLower: { $trim: { input: "$tags" } } }, // Limpia y pasa a minúsculas
                    count: { $sum: 1 } // Cuenta las repeticiones
                } 
            },
            { $sort: { count: -1 } } // Ordena de mayor a menor uso
        ]);

        // 3. Cálculos adicionales
        const totalUniqueTags = stats.length;
        const totalWallpapers = await Wallpaper.countDocuments();
        const totalTagOccurrences = stats.reduce((acc, curr) => acc + curr.count, 0);

        // 4. MOSTRAR RESULTADOS
        console.log(`=========================================`);
        console.log(`📊 ESTADÍSTICAS GLOBALES DE ETIQUETAS`);
        console.log(`=========================================`);
        console.log(`🖼️  Total de Wallpapers:   ${totalWallpapers}`);
        console.log(`🏷️  Etiquetas Únicas:      ${totalUniqueTags}`);
        console.log(`📈  Uso total de tags:     ${totalTagOccurrences}`);
        console.log(`=========================================\n`);

        console.log(`🔥 TOP 200 ETIQUETAS MÁS USADAS:`);
        console.log(`-----------------------------------------`);
        
        stats.slice(0, 500).forEach((tag, index) => {
            const position = (index + 1).toString().padStart(2, ' ');
            const tagName = tag._id.padEnd(20, ' ');
            console.log(`${position}. [${tagName}] -> Usada en ${tag.count} obras`);
        });

        console.log(`\n-----------------------------------------`);
        if (totalUniqueTags > 500) {
            console.log(`... y otras ${totalUniqueTags - 500} etiquetas más.`);
        }
        console.log(`=========================================`);

        process.exit(0);
    } catch (error) {
        console.error('❌ Error en el análisis:', error);
        process.exit(1);
    }
};

analyzeTags();