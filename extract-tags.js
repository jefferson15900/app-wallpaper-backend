require('dotenv').config();
const mongoose = require('mongoose');
const Wallpaper = require('./src/models/Wallpaper'); // Asegúrate que la ruta sea correcta

const extractTags = async () => {
    try {
        console.log('📡 Conectando a la base de datos...');
        await mongoose.connect(process.env.MONGO_URI);
        console.log('✅ Conexión establecida.');

        console.log('🔍 Extrayendo etiquetas únicas...');

        const tags = await Wallpaper.distinct('tags');

        console.log('\n--- LISTA DE ETIQUETAS ENCONTRADAS ---');
        console.log(JSON.stringify(tags.sort(), null, 2));
        
        console.log('\n--------------------------------------');
        console.log(`📊 Total de etiquetas únicas: ${tags.length}`);
        console.log('--------------------------------------');

        process.exit(0);
    } catch (err) {
        console.error('❌ Error:', err);
        process.exit(1);
    }
};

extractTags();