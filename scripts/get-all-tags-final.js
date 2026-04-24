require('dotenv').config();
const mongoose = require('mongoose');
const Wallpaper = require('../src/models/Wallpaper'); 

const getAllTags = async () => {
    try {
        console.log('📡 Conectando a MongoDB...');
        await mongoose.connect(process.env.MONGO_URI);
        console.log('✅ Conexión exitosa.\n');

        // 1. Obtenemos todas las etiquetas únicas de la colección de Wallpapers
        const allTags = await Wallpaper.distinct('tags');

        // 2. Las ordenamos alfabéticamente para que sea más fácil revisarlas
        allTags.sort();

        console.log(`=========================================`);
        console.log(`🏷️  LISTA COMPLETA DE TAGS (${allTags.length})`);
        console.log(`=========================================`);
        
        // Imprimimos el objeto JSON puro para que lo copies fácil
        console.log(JSON.stringify(allTags, null, 2));

        console.log(`\n=========================================`);
        console.log(`💡 COPIA EL BLOQUE JSON DE ARRIBA`);
        console.log(`=========================================`);

        process.exit(0);
    } catch (error) {
        console.error('❌ Error extrayendo tags:', error);
        process.exit(1);
    }
};

getAllTags();