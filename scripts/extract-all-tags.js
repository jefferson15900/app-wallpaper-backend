require('dotenv').config();
const mongoose = require('mongoose');
const fs       = require('fs/promises');  // async, no bloquea
const path     = require('path');
const Wallpaper = require('../src/models/Wallpaper');

// Cierre limpio en cualquier escenario
const shutdown = async (code = 0) => {
  await mongoose.disconnect();
  console.log('🔌 Conexión cerrada.');
  process.exit(code);
};

process.on('SIGINT',  () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

const extractTags = async () => {
  console.log('📡 Conectando a MongoDB...');
  await mongoose.connect(process.env.MONGO_URI);
  console.log('✅ Conexión exitosa.\n');

  console.log('📦 Extrayendo etiquetas...');

  const results = await Wallpaper.aggregate([
    { $unwind: '$tags' },
    {
      $group: {
        _id:   { $toLower: { $trim: { input: '$tags' } } },
        count: { $sum: 1 }
      }
    },
    { $sort: { count: -1 } }
  ]);

  // --- Análisis bilingüe (util para saber cuánto trabajo queda) ---
  const ASCII_RE  = /^[a-z0-9\-\s]+$/;     // probablemente inglés
  const LATIN_RE  = /[áéíóúüñ]/;           // probablemente español u otro

  const tags = results.map(t => ({
    tag:   t._id,
    usage: t.count,
    lang:  LATIN_RE.test(t._id) ? 'es'
         : ASCII_RE.test(t._id) ? 'en'
         : 'unknown'
  }));

  // --- Estadísticas del reporte ---
  const stats = {
    total:   tags.length,
    en:      tags.filter(t => t.lang === 'en').length,
    es:      tags.filter(t => t.lang === 'es').length,
    unknown: tags.filter(t => t.lang === 'unknown').length,
    // Top 10 para preview rápido en consola
    top10:   tags.slice(0, 10).map(t => `${t.tag} (${t.usage})`),
  };

  // --- Guardar reporte completo ---
  const outDir  = path.resolve(__dirname, '../reports');
  await fs.mkdir(outDir, { recursive: true });  // crea /reports si no existe

  const timestamp = new Date().toISOString().slice(0, 10);
  const outFile   = path.join(outDir, `tags-report-${timestamp}.json`);

  await fs.writeFile(outFile, JSON.stringify({ stats, tags }, null, 2), 'utf8');

  // --- Output en consola ---
  console.log('=========================================');
  console.log('✅ EXTRACCIÓN COMPLETADA');
  console.log('=========================================');
  console.log(`🏷️  Total único:  ${stats.total}`);
  console.log(`🇬🇧 En inglés:    ${stats.en}`);
  console.log(`🇪🇸 En español:   ${stats.es}`);
  console.log(`❓ Sin detectar:  ${stats.unknown}`);
  console.log(`📄 Guardado en:   ${outFile}`);
  console.log('=========================================');
  console.log('🔝 Top 10 tags:');
  stats.top10.forEach((t, i) => console.log(`   ${i + 1}. ${t}`));
  console.log('');
  console.log('💡 Siguiente paso: corre el script de canonicalización');
  console.log(`   sobre los ${stats.es + stats.unknown} tags no-ingleses.`);
};

extractTags()
  .then(() => shutdown(0))
  .catch(err => {
    console.error('❌ Error:', err.message);
    shutdown(1);
  });