require('dotenv').config();
const mongoose = require('mongoose');
const Wallpaper = require('../src/models/Wallpaper');
const TagMap = require('../src/models/TagMap');
const { resolveToCanonical } = require('../src/utils/tagResolver');
const nlp = require('compromise');

const singularizeSpanish = (word) => {
    if (!word || word.length <= 3) return word;
    if (word.endsWith('es')) {
        const stem = word.slice(0, -2);
        const consonantes = 'bcdfghjklmnpqrstvwxyz';
        if (consonantes.includes(stem[stem.length - 1])) {
            return stem;
        }
        return word.slice(0, -1);
    }
    if (word.endsWith('s') && !word.endsWith('is') && !word.endsWith('us')) {
        return word.slice(0, -1);
    }
    return word;
};

async function test() {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('✅ Conectado a MongoDB...');

        const rawSearch = 'supercar';
        console.log(`\n🔍 Término de búsqueda original: "${rawSearch}"`);

        // 1. Singularización
        const singularSearchEnglish = (() => {
            const s = nlp(rawSearch).nouns().toSingular().text().trim();
            return s?.length >= 2 ? s : rawSearch;
        })();
        const singularSearchSpanish = singularizeSpanish(rawSearch);

        console.log(`   - Singular inglés: "${singularSearchEnglish}"`);
        console.log(`   - Singular español: "${singularSearchSpanish}"`);

        // 2. Resolución de sinónimos
        const [canonicalEnglish, canonicalSpanish, allSynonyms] = await Promise.all([
            resolveToCanonical(singularSearchEnglish),
            resolveToCanonical(singularSearchSpanish),
            TagMap.find({ original: { $in: [rawSearch, singularSearchEnglish, singularSearchSpanish] } }).lean(),
        ]);

        console.log(`   - Canonical English: "${canonicalEnglish}"`);
        console.log(`   - Canonical Spanish: "${canonicalSpanish}"`);
        console.log(`   - All Synonyms direct matches:`, allSynonyms.map(t => `${t.original} -> ${t.canonical}`));

        const canonicalSynonyms = [];
        if (canonicalEnglish) {
            const csEng = await TagMap.find({ canonical: canonicalEnglish }).lean();
            canonicalSynonyms.push(...csEng);
        }
        if (canonicalSpanish && canonicalSpanish !== canonicalEnglish) {
            const csEsp = await TagMap.find({ canonical: canonicalSpanish }).lean();
            canonicalSynonyms.push(...csEsp);
        }

        const expandedTerms = new Set(
            [rawSearch, singularSearchEnglish, singularSearchSpanish, canonicalEnglish, canonicalSpanish].filter(Boolean)
        );
        [...allSynonyms, ...canonicalSynonyms].forEach(t => {
            if (t.original) expandedTerms.add(t.original);
            if (t.canonical) expandedTerms.add(t.canonical);
        });

        const finalTerms = [...expandedTerms];
        console.log(`✨ Términos expandidos para la búsqueda:`, finalTerms);

        // 3. Ejecutar búsqueda estándar
        const results = await Wallpaper.find({
            status: 'approved',
            tags: { $in: finalTerms }
        }).select('_id tags imageUrl').limit(10).lean();

        console.log(`\n📊 RESULTADOS ENCONTRADOS: ${results.length}`);
        results.forEach((w, i) => {
            console.log(`   [${i + 1}] ID: ${w._id}`);
            console.log(`       - Tags: ${JSON.stringify(w.tags)}`);
            console.log(`       - Image: ${w.imageUrl}`);
        });

        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}
test();
