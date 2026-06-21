require('dotenv').config();
const mongoose = require('mongoose');
const TagMap = require('../src/models/TagMap');
const { SYNONYMS } = require('../src/config/tags');

async function syncSynonyms() {
    try {
        console.log('🔌 Conectando a MongoDB...');
        await mongoose.connect(process.env.MONGO_URI);
        console.log('✅ Conectado con éxito.');

        const synonymEntries = Object.entries(SYNONYMS);
        console.log(`📊 Total de sinónimos en config/tags.js: ${synonymEntries.length}`);

        const bulkOps = synonymEntries.map(([original, canonical]) => ({
            updateOne: {
                filter: { original: original.toLowerCase().trim() },
                update: { 
                    $set: { 
                        canonical: canonical.toLowerCase().trim(),
                        language: 'es' // Marcado como es/aliases
                    } 
                },
                upsert: true
            }
        }));

        if (bulkOps.length > 0) {
            console.log('🚀 Sincronizando sinónimos con TagMap en MongoDB...');
            const result = await TagMap.bulkWrite(bulkOps, { ordered: false });
            console.log(`✨ Sincronización completada:`);
            console.log(`   - Encontrados/Mapeados: ${result.matchedCount}`);
            console.log(`   - Creados (Upserted):  ${result.upsertedCount}`);
            console.log(`   - Modificados:         ${result.modifiedCount}`);
        } else {
            console.log('⚠️ No hay sinónimos que sincronizar.');
        }

        process.exit(0);
    } catch (error) {
        console.error('❌ Error al sincronizar sinónimos:', error);
        process.exit(1);
    }
}

syncSynonyms();
