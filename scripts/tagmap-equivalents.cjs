const fs = require('node:fs');
const path = require('node:path');
const mongoose = require('mongoose');
const { normalizeTerm } = require('../src/utils/wallpaperMetadata');
const { LOCAL_TAG_ALIASES, resolveLocalTag, equivalentSearchTags } = require('../src/config/tags');

// Supplement the local dictionary using concepts found in the actual TagMap audit.
const SPANISH_EQUIVALENTS = {
    aerial: ['aereo', 'aerea', 'aereos', 'aereas', 'vista aerea', 'vista desde arriba'],
    adorable: ['adorables'], angry: ['enojada', 'enojados', 'enojadas', 'enfadado', 'enfadada', 'furioso', 'furiosa'],
    animation: ['animaciones'], aquarium: ['acuarios', 'pecera', 'peceras'],
    architecture: ['arquitectonico', 'arquitectonica'],
    blood: ['sangriento', 'sangrienta'], bubbles: ['burbuja', 'pompa', 'pompas', 'pompas de jabon'],
    cards: ['carta', 'naipe', 'naipes', 'baraja'], character: ['personajes'], chick: ['pollitos', 'polluelo', 'polluelos'],
    circle: ['circulos', 'circular'], classic: ['clasica', 'clasicos', 'clasicas'], cliffs: ['paredes rocosas'],
    cloak: ['capas', 'capa con capucha'], closeup: ['primer plano', 'primeros planos'], coat: ['abrigos'],
    coffee: ['taza de cafe', 'cafe en taza'], colorful: ['colorida', 'coloridos', 'coloridas', 'multicolor', 'multicolores'],
    colors: ['color', 'tonalidades'], computer: ['computador', 'computadores', 'computadoras', 'ordenador', 'ordenadores', 'pc'],
    cosmic: ['cosmica', 'cosmicos', 'cosmicas'], crack: ['grietas', 'rajadura', 'rajaduras'],
    creepy: ['perturbadora', 'escalofriante', 'escalofriantes', 'espeluznante', 'espeluznantes'],
    cross: ['cruces'], crystals: ['cristal', 'cristalino', 'cristalina'], cunning: ['astuta', 'astutos', 'astutas'],
    curve: ['curvado', 'curvada'], cute: ['linda', 'lindos', 'lindas', 'bonito', 'bonita', 'bonitos', 'bonitas'],
    cyborg: ['ciborg', 'ciborgs'], dark: ['oscura', 'oscuros', 'oscuras', 'oscuridad', 'tenebroso', 'tenebrosa'],
    diver: ['buzos', 'buzo de buceo', 'buceador', 'buceadora', 'buceadores', 'submarinista'],
    drops: ['gotitas', 'gota de agua', 'gotas de agua'], envelope: ['sobres', 'sobre de carta'],
    firefly: ['luciernagas', 'bicho de luz', 'bichos de luz'], flow: ['fluir'],
    fluffy: ['esponjoso', 'esponjosa', 'esponjosos', 'esponjosas'], fluid: ['fluida', 'fluidos', 'fluidas'],
    foam: ['espuma', 'espumoso', 'espumosa'], fog: ['niebla', 'neblina', 'bruma', 'nebuloso', 'nebulosa'],
    friends: ['amigo', 'amiga', 'amigas', 'amigos', 'amistad'], funny: ['divertido', 'divertida', 'gracioso', 'graciosa', 'comico', 'comica'],
    fur: ['pelaje', 'pelo de animal'], futuristic: ['futuristas'], garage: ['garajes', 'cochera', 'cocheras'],
    geometric: ['geometrico', 'geometrica', 'geometricos', 'geometricas'], geometry: ['geometria'],
    girl: ['mujer', 'mujeres', 'muchachas', 'chicas'], glove: ['guantes'],
    'glowing eyes': ['ojos brillantes', 'ojos luminosos', 'ojos resplandecientes'],
    gradient: ['degradados', 'degrade', 'gradiente', 'gradientes'], graffiti: ['grafitis', 'graffitis'],
    group: ['grupos', 'agrupacion'], happy: ['contento', 'contenta', 'alegre', 'alegres', 'felices'],
    hero: ['heroes', 'heroina', 'heroinas'], hill: ['colinas', 'cerro', 'cerros', 'loma', 'lomas'],
    horror: ['terror', 'terrorifico', 'terrorifica'], icons: ['icono', 'iconos', 'simbolo', 'simbolos'],
    lizard: ['lagartos', 'lagartija', 'lagartijas'], love: ['amor', 'romance', 'romantico', 'romantica'],
    luxury: ['lujoso', 'lujosa', 'lujosos', 'lujosas'], magic: ['magico', 'magica', 'magicos', 'magicas'],
    map: ['mapas', 'mapamundi'], match: ['cerillo', 'cerillos', 'fosforo', 'fosforos'],
    modern: ['moderna', 'modernos', 'modernas'], monochrome: ['monocromatico', 'monocromatica', 'monocromo', 'monocroma'],
    motion: ['movimiento', 'en movimiento'], mouse: ['ratones', 'ratoncito'], muscle: ['musculo', 'musculos', 'musculoso', 'musculosa'],
    music: ['musica', 'musical'], nature: ['naturaleza', 'natural', 'naturales'],
    palm: ['palmera', 'palmeras', 'palma', 'palmas'], party: ['fiestas', 'festivo', 'festiva'],
    passion: ['pasion', 'apasionado', 'apasionada'], peek: ['asomado', 'asomada', 'asomandose'],
    petal: ['petalo'], pointing: ['senalando', 'apuntando'], portrait: ['retratos'],
    racing: ['carreras', 'carrera', 'competicion automovilistica'], reptile: ['reptiles'],
    shape: ['figura geometrica', 'forma geometrica'], shapes: ['figuras geometricas', 'formas geometricas'],
    skateboard: ['patinetas', 'monopatin', 'monopatines'], sky: ['cielos'],
    sneakers: ['calzado deportivo', 'zapatilla deportiva', 'zapatillas deportivas'],
    snowy: ['cubierto de nieve', 'cubierta de nieve'], soft: ['suaves', 'suavidad'],
    spikes: ['pua', 'puas', 'pinchos', 'pincho'], spoiler: ['aleron', 'alerones'],
    sponge: ['esponjas'], sport: ['deportes', 'deportivo'], squares: ['figuras cuadradas'],
    star: ['estrellita', 'estrellitas'], stones: ['piedra', 'piedras'], stripes: ['rayas', 'franjas', 'raya', 'franja'],
    studio: ['estudio fotografico'], sunglasses: ['gafas de sol', 'lentes de sol', 'anteojos de sol'],
    technology: ['tecnologia', 'tecnologico', 'tecnologica'], text: ['texto', 'textos', 'letras'],
    texture: ['texturas', 'texturizado', 'texturizada'], track: ['pistas', 'circuito', 'circuitos'],
    triangle: ['triangulos', 'triangular'], underwater: ['debajo del agua', 'subacuatico', 'subacuatica', 'sumergido', 'sumergida'],
    wall: ['paredes', 'muro', 'muros'], wave: ['ola'], wet: ['mojado', 'mojada', 'mojados', 'mojadas'],
    wheel: ['ruedas'],
};
const ENGLISH_EQUIVALENTS = {
    girl: ['woman', 'women', 'young woman', 'young women'],
    car: ['automobile', 'automobiles'], glasses: ['eyeglasses', 'spectacles'],
    motorcycle: ['motorbikes'], 'sports car': ['sports cars'],
    closeup: ['close up', 'close-up'], cartoon: ['cartoons'],
    'anime girl': ['anime woman', 'anime women', 'anime girls'],
    colorful: ['colourful'], computer: ['computers'], dark: ['darkness'],
    fog: ['mist'], friends: ['friend', 'friendship'], happy: ['cheerful'],
    monochrome: ['monochromatic'], nature: ['natural scenery'],
    portrait: ['portraits'], sunglasses: ['sun glasses'],
};
// Multiword English aliases are listed explicitly; single words can share one list.
const ENGLISH_PHRASES = new Set(['video game', 'video games', 'three dimensional', 'space ship', 'space ships', 'night time', 'day time', 'outer space', 'full moons']);
const ENGLISH_WORDS = new Set('cartoons minimalism videogame videogames illustrations motivation grey golden cities metropolis cars girls boys men women animals dogs cats dragons robots planets spaceships spacecraft flowers astronauts nighttime daytime rainy raining snowy snowing sunsets forests woods woodland sea oceans seas mountains deserts beaches streets motorbike motorcycles vehicles rabbits birds ducks turtles dolphins jellyfish penguins giraffes monkeys leopards chameleons dinosaurs zebras trees islands clouds rock roads houses rooms doors boats umbrellas headphones keyboards guitars hoodies hats suits sneakers toys hearts pumpkins apples cubes hexagons squares ghosts monsters vampires superheroes archers clowns warriors knights witches wizards castles bridges towers lighthouses temples armour tattoos skulls shadows reflections smiles surrealist'.split(' '));

function buildPlan(rows) {
    const existing = new Map();
    for (const row of rows) {
        const key = normalizeTerm(row.original);
        if (!existing.has(key)) { existing.set(key, []); }
        existing.get(key).push(row);
    }
    const targets = new Set(rows.map(row => normalizeTerm(row.canonical)));
    const candidates = new Map();
    const skipped = [];
    function add(original, requestedCanonical, language) {
        const alias = normalizeTerm(original);
        const preferred = normalizeTerm(requestedCanonical);
        const canonical = targets.has(preferred) ? preferred : [...targets].find(target => resolveLocalTag(target) === preferred);
        if (!canonical || alias === canonical || existing.has(alias)) { return; }
        if (LOCAL_TAG_ALIASES.has(alias) && !equivalentSearchTags(alias).includes(resolveLocalTag(canonical))) {
            skipped.push({ original: alias, canonical, reason: 'conflicts-with-local-dictionary' });
            return;
        }
        const previous = candidates.get(alias);
        if (previous && previous.canonical !== canonical) {
            candidates.delete(alias);
            skipped.push({ original: alias, canonical, reason: 'ambiguous-proposal' });
            return;
        }
        if (skipped.some(row => row.original === alias && row.reason === 'ambiguous-proposal')) { return; }
        candidates.set(alias, { original: alias, canonical, language });
    }
    for (const [alias] of LOCAL_TAG_ALIASES) {
        const language = ENGLISH_PHRASES.has(alias) || ENGLISH_WORDS.has(alias) ? 'en' : 'es';
        add(alias, resolveLocalTag(alias), language);
    }
    for (const [canonical, aliases] of Object.entries(SPANISH_EQUIVALENTS)) {
        for (const alias of aliases) { add(alias, canonical, 'es'); }
    }
    for (const [canonical, aliases] of Object.entries(ENGLISH_EQUIVALENTS)) {
        for (const alias of aliases) { add(alias, canonical, 'en'); }
    }
    return { beforeCount: rows.length, inserts: [...candidates.values()].sort((a, b) => a.canonical.localeCompare(b.canonical) || a.original.localeCompare(b.original)), skipped };
}

async function main() {
    const project = path.resolve(__dirname, '..');
    const directory = path.join(project, 'reports/tagmap-enrichment');
    if (!process.argv.includes('--apply')) {
        const plan = buildPlan(JSON.parse(fs.readFileSync(path.join(directory, 'before.json'), 'utf8')));
        fs.writeFileSync(path.join(directory, 'plan.json'), JSON.stringify(plan, null, 2) + '\n');
        console.log(JSON.stringify({ before: plan.beforeCount, planned: plan.inserts.length, concepts: new Set(plan.inserts.map(row => row.canonical)).size, skipped: plan.skipped }));
        return;
    }
    require('dotenv').config({ path: path.join(project, '.env'), quiet: true });
    const connection = await mongoose.createConnection(process.env.MONGO_URI, { autoIndex: false, autoCreate: false, serverSelectionTimeoutMS: 10000, connectTimeoutMS: 10000 }).asPromise();
    try {
        const collection = connection.collection('tagmaps');
        const before = JSON.parse(fs.readFileSync(path.join(directory, 'before.json'), 'utf8'));
        const approved = JSON.parse(fs.readFileSync(path.join(directory, 'plan.json'), 'utf8'));
        const live = await collection.find({}).sort({ _id: 1 }).toArray();
        if (JSON.stringify(live) !== JSON.stringify(before)) { throw new Error('La colección cambió desde la revisión. Genera un respaldo y plan nuevos.'); }
        const plan = buildPlan(live);
        if (JSON.stringify(plan) !== JSON.stringify(approved)) { throw new Error('El plan cambió desde la revisión.'); }
        const operations = plan.inserts.map(row => ({ updateOne: {
            filter: { original: row.original }, update: { $setOnInsert: row }, upsert: true,
        } }));
        const result = operations.length ? await collection.bulkWrite(operations, { ordered: false }) : { upsertedCount: 0 };
        const after = await collection.find({}).sort({ _id: 1 }).toArray();
        fs.writeFileSync(path.join(directory, 'after.json'), JSON.stringify(after, null, 2) + '\n');
        const afterById = new Map(after.map(row => [String(row._id), row]));
        const unchanged = before.every(row => JSON.stringify(row) === JSON.stringify(afterById.get(String(row._id))));
        const present = plan.inserts.every(row => after.some(actual => actual.original === row.original && actual.canonical === row.canonical && actual.language === row.language));
        const report = { before: before.length, inserted: result.upsertedCount, after: after.length, originalRecordsUnchanged: unchanged, allPlannedRowsVerified: present, conceptsExpanded: new Set(plan.inserts.map(row => row.canonical)).size };
        fs.writeFileSync(path.join(directory, 'result.json'), JSON.stringify(report, null, 2) + '\n');
        console.log(JSON.stringify(report));
        if (!unchanged || !present) { throw new Error('La verificación de la base de datos no coincide con el plan.'); }
    } finally { await connection.close(); }
}

if (require.main === module) {
    const timeout = setTimeout(() => { console.error('Tiempo de operación agotado.'); process.exit(1); }, 30000);
    main().catch(error => { console.error(error.code || error.name, error.message.includes('plan') || error.message.includes('colección') || error.message.includes('verificación') ? error.message : 'No se pudo completar la operación.'); process.exitCode = 1; }).finally(() => clearTimeout(timeout));
}
module.exports = { buildPlan };
