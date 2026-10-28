const { createHash } = require('node:crypto');
const { ALIASES, effectiveMetadata, normalizeTerm, resolveMetadataAlias } = require('./wallpaperMetadata');
const { normalizeSearchText, IGNORED_SEARCH_WORDS } = require('./searchQuery');

const FIELDS = ['styles', 'subjects', 'environments', 'colors', 'characters', 'franchises'];
// Vocabulary, not a list of collections: a topic exists only when the catalogue supports it.
const SUBJECTS = {
    city: ['Ciudades', 'Cities'], car: ['Autos', 'Cars'], girl: ['Chicas', 'Girls'], boy: ['Chicos', 'Boys'],
    man: ['Hombres', 'Men'], woman: ['Mujeres', 'Women'], animal: ['Animales', 'Animals'],
    dog: ['Perros', 'Dogs'], cat: ['Gatos', 'Cats'], dragon: ['Dragones', 'Dragons'], robot: ['Robots', 'Robots'],
    planet: ['Planetas', 'Planets'], spaceship: ['Naves espaciales', 'Spaceships'], flower: ['Flores', 'Flowers'],
    astronaut: ['Astronautas', 'Astronauts'],
};
const STYLES = {
    anime: ['Anime', 'Anime', 'de anime'], cartoon: ['Caricaturas', 'Cartoons', 'de caricatura'],
    cyberpunk: ['Ciberpunk', 'Cyberpunk', 'ciberpunk'], fantasy: ['Fantasía', 'Fantasy', 'de fantasía'],
    'sci-fi': ['Ciencia ficción', 'Sci-fi', 'de ciencia ficción'], abstract: ['Arte abstracto', 'Abstract art', 'en arte abstracto'],
    minimalist: ['Minimalismo', 'Minimalism', 'minimalistas'], gaming: ['Videojuegos', 'Gaming', 'de videojuegos'],
    'pixel art': ['Arte pixelado', 'Pixel art', 'en arte pixelado'], illustration: ['Ilustraciones', 'Illustrations', 'en ilustración'],
    photography: ['Fotografía', 'Photography', 'en fotografía'], '3d': ['Arte en 3D', '3D art', 'en 3D'],
    motivational: ['Inspiración', 'Motivation', ''], typography: ['Tipografía', 'Typography', ''],
};
const ENVIRONMENTS = {
    night: ['Escenas nocturnas', 'Night scenes', 'de noche', 'at night'],
    day: ['Escenas de día', 'Daytime scenes', 'de día', 'by day'],
    rain: ['Escenas bajo la lluvia', 'Rainy scenes', 'bajo la lluvia', 'in the rain'],
    snow: ['Paisajes con nieve', 'Snowy landscapes', 'en la nieve', 'in the snow'],
    sunset: ['Atardeceres', 'Sunsets', 'al atardecer', 'at sunset'],
    forest: ['Bosques', 'Forests', 'en el bosque', 'in the forest'], ocean: ['Océanos', 'Oceans', 'en el océano', 'in the ocean'],
    mountain: ['Montañas', 'Mountains', 'en las montañas', 'in the mountains'],
    desert: ['Desiertos', 'Deserts', 'en el desierto', 'in the desert'],
    space: ['El espacio', 'Outer space', 'en el espacio', 'in space'],
    beach: ['Playas', 'Beaches', 'en la playa', 'at the beach'], street: ['Calles', 'Streets', 'en la calle', 'on the street'],
};
const COLORS = {
    blue: ['azul', 'blue'], red: ['rojo', 'red'], green: ['verde', 'green'], purple: ['morado', 'purple'],
    pink: ['rosa', 'pink'], yellow: ['amarillo', 'yellow'], orange: ['naranja', 'orange'], black: ['negro', 'black'],
    white: ['blanco', 'white'], gray: ['gris', 'gray'], brown: ['marrón', 'brown'], gold: ['dorado', 'gold'],
    turquoise: ['turquesa', 'turquoise'],
};
const PAIRS = [['subjects', 'environments'], ['styles', 'subjects'], ['styles', 'colors'], ['subjects', 'colors']];
const EN_STYLE_SUBJECT = {
    anime: 'Anime {subject}', cartoon: 'Cartoon {subject}', cyberpunk: 'Cyberpunk {subject}', fantasy: 'Fantasy {subject}',
    'sci-fi': 'Sci-fi {subject}', abstract: 'Abstract {subject}', minimalist: 'Minimalist {subject}',
    gaming: '{subject} from video games', 'pixel art': '{subject} in pixel art', illustration: 'Illustrated {subject}',
    photography: 'Photos of {subject}', '3d': '3D {subject}',
};
const upperFirst = value => value.charAt(0).toUpperCase() + value.slice(1);
const nameLabel = value => value === 'pokemon' ? 'Pokémon' : value.split(' ').map(upperFirst).join(' ');

function concept(field, raw) {
    if (typeof raw !== 'string' || !raw.trim() || raw.length > 60 || /[\x00-\x1f<>\n]/.test(raw)) return null;
    const term = resolveMetadataAlias(raw) ?? normalizeTerm(raw);
    if (field === 'characters' || field === 'franchises') return { field, term };
    const vocabulary = { subjects: SUBJECTS, styles: STYLES, environments: ENVIRONMENTS, colors: COLORS }[field];
    return vocabulary && Object.hasOwn(vocabulary, term) ? { field, term } : null;
}

function topicTitles(concepts) {
    const by = Object.fromEntries(concepts.map(value => [value.field, value.term]));
    if (concepts.length === 1) {
        if (by.styles) return {
            es: by.styles === 'minimalist' ? 'Fondos minimalistas' : by.styles === '3d' ? 'Arte en 3D' : `Fondos de ${STYLES[by.styles][0].toLowerCase()}`,
            en: by.styles === 'cartoon' ? 'Cartoon wallpapers' : by.styles === 'minimalist' ? 'Minimalist wallpapers' : `${STYLES[by.styles][1]} wallpapers`,
        };
        if (by.subjects) return { es: `Fondos de ${SUBJECTS[by.subjects][0].toLowerCase()}`, en: `${upperFirst(by.subjects)} wallpapers` };
        if (by.environments) return { es: ENVIRONMENTS[by.environments][0], en: ENVIRONMENTS[by.environments][1] };
        if (by.colors) return { es: `Fondos en ${COLORS[by.colors][0]}`, en: `${upperFirst(COLORS[by.colors][1])} wallpapers` };
        const name = nameLabel(by.characters || by.franchises);
        return { es: `Fondos de ${name}`, en: `${name} wallpapers` };
    }
    if (concepts.length !== 2) return null;
    if (by.subjects && by.environments) return {
        es: `${SUBJECTS[by.subjects][0]} ${ENVIRONMENTS[by.environments][2]}`,
        en: `${SUBJECTS[by.subjects][1]} ${ENVIRONMENTS[by.environments][3]}`,
    };
    if (by.styles && by.subjects && STYLES[by.styles][2]) return {
        es: `${SUBJECTS[by.subjects][0]} ${STYLES[by.styles][2]}`,
        en: upperFirst(EN_STYLE_SUBJECT[by.styles].replace('{subject}', SUBJECTS[by.subjects][1].toLowerCase())),
    };
    if (by.colors && (by.styles || by.subjects)) return {
        es: `${by.styles ? STYLES[by.styles][0] : SUBJECTS[by.subjects][0]} en ${COLORS[by.colors][0]}`,
        en: `${by.styles ? STYLES[by.styles][1] : SUBJECTS[by.subjects][1]} in ${COLORS[by.colors][1]}`,
    };
    return null;
}

const conceptKey = value => `${value.field}:${value.term}`;
const topicKey = concepts => concepts.map(conceptKey).sort().join('|');

function queryFor(concepts, language) {
    return concepts.map(({ field, term }) => {
        // Explicit aliases are also understood by the existing search resolver.
        if (language === 'es' && ALIASES[field]?.[term]?.length) return ALIASES[field][term][0];
        return term;
    }).join(' ');
}

function searchVocabulary(available) {
    return [...available.values()].flatMap(value => [value.term, ...(ALIASES[value.field]?.[value.term] || [])]
        .map(alias => ({ value, alias: normalizeSearchText(alias) }))).sort((a, b) => b.alias.length - a.alias.length);
}

function searchConcepts(term, available, aliases = searchVocabulary(available)) {
    if (typeof term !== 'string' || term.length > 150) return [];
    let remaining = ` ${normalizeSearchText(term)} `;
    const matches = [];
    for (const { value, alias } of aliases) {
        const needle = ` ${alias} `;
        if (remaining.includes(needle)) {
            remaining = remaining.split(needle).join(' ');
            if (!matches.some(match => conceptKey(match) === conceptKey(value))) matches.push(value);
        }
    }
    // Reject unsupported words instead of silently dropping part of someone's search.
    return remaining.trim().split(/\s+/).filter(Boolean).every(word => IGNORED_SEARCH_WORDS.has(word)) ? matches : [];
}

function buildDiscoveryTopics(wallpapers, searches = []) {
    const topics = new Map(), available = new Map();
    for (const wallpaper of wallpapers) {
        if (wallpaper.status !== 'approved' || wallpaper.artistActive === false) continue;
        for (const image of wallpaper.images?.length ? wallpaper.images.slice(0, 10) : [{ imageUrl: wallpaper.imageUrl }]) {
            const metadata = effectiveMetadata(image, wallpaper.metadata);
            const fields = Object.fromEntries(FIELDS.map(field => [field, [...new Set(Array.isArray(metadata[field]) ? metadata[field] : [])]
                .slice(0, 8).map(raw => concept(field, raw)).filter(Boolean)]));
            const singles = FIELDS.flatMap(field => fields[field].map(value => [value]));
            // ponytail: at most two values per field participate in pairs; all eight still get single topics.
            const pairs = PAIRS.flatMap(([a, b]) => fields[a].slice(0, 2).flatMap(left => fields[b].slice(0, 2).map(right => [left, right])));
            for (const concepts of [...singles, ...pairs]) {
                const titles = topicTitles(concepts);
                const imageUrl = image.imageUrl || wallpaper.imageUrl;
                if (!titles || !imageUrl || Math.max(titles.es.length, titles.en.length) > 100) continue;
                const key = topicKey(concepts);
                if (!topics.has(key)) {
                    // Bound cache memory on unusually diverse catalogues.
                    if (topics.size >= 20000) continue;
                    topics.set(key, { id: createHash('sha256').update(key).digest('hex').slice(0, 20), titles, concepts,
                        queries: { es: queryFor(concepts, 'es'), en: queryFor(concepts, 'en') }, ids: new Set(), items: [], searchScore: 0 });
                }
                concepts.forEach(value => available.set(conceptKey(value), value));
                const topic = topics.get(key), id = String(wallpaper._id);
                if (!topic.ids.has(id)) {
                    topic.ids.add(id);
                    if (topic.items.length < 24) topic.items.push({ _id: id, imageUrl, type: wallpaper.type || 'image',
                        price: wallpaper.price || 0, ...(image.assetId ? { matchedAssetId: image.assetId } : {}) });
                }
            }
        }
    }
    const aliases = searches.length ? searchVocabulary(available) : [];
    for (const search of searches) {
        const concepts = searchConcepts(search.term, available, aliases);
        const topic = topics.get(topicKey(concepts));
        if (topic && Number.isFinite(search.engagement) && search.engagement > 0) topic.searchScore += search.engagement;
    }
    // Four distinct publications, never four files from the same carousel.
    return [...topics.values()].filter(topic => topic.ids.size >= 4);
}

function parseTopicInterests(raw) {
    if (raw === undefined) return [];
    if (typeof raw !== 'string' || raw.length > 4000) throw new Error('Invalid interests');
    const values = JSON.parse(raw);
    if (!Array.isArray(values) || values.length > 24 || values.some(value => !value ||
        ![...FIELDS, 'tags'].includes(value.field) || typeof value.term !== 'string' || value.term.length > 80 ||
        !value.term.trim() || !Number.isFinite(value.score) || value.score < 0)) throw new Error('Invalid interests');
    return values.map(value => ({ ...value, term: resolveMetadataAlias(value.term) ?? normalizeTerm(value.term), score: Math.min(value.score, 100) }));
}

function selectDiscoveryTopics(topics, language, interests = [], limit = 8) {
    const ranked = topics.map(topic => {
        const interestScore = topic.concepts.reduce((total, value) => total + Math.max(0, ...interests
            .filter(interest => (interest.field === 'tags' || interest.field === value.field) && interest.term === value.term)
            .map(interest => interest.score)), 0);
        return { topic, interestScore, score: interestScore * 2 + Math.log1p(topic.ids.size) + Math.log1p(topic.searchScore) * 3 + (topic.concepts.length - 1) };
    }).sort((a, b) => b.score - a.score || a.topic.id.localeCompare(b.topic.id));
    const selected = [];
    const tooSimilar = topic => selected.some(previous => {
        const smaller = topic.ids.size < previous.topic.ids.size ? topic.ids : previous.topic.ids;
        const larger = smaller === topic.ids ? previous.topic.ids : topic.ids;
        let common = 0;
        for (const id of smaller) if (larger.has(id)) common++;
        return common / smaller.size >= 0.8;
    }) || topic.concepts.some(concept => selected.filter(previous => previous.topic.concepts
        .some(value => conceptKey(value) === conceptKey(concept))).length >= 2);
    for (const entry of ranked) {
        const { topic } = entry;
        if (!topic.titles[language] || !topic.queries[language]) continue;
        // Suppress near duplicates and subsets, not just differently named collections of identical size.
        if (tooSimilar(topic)) continue;
        // Reserve two of eight slots for discovery outside the strongest interests when possible.
        if (entry.interestScore > 0 && selected.filter(value => value.interestScore > 0).length >= limit - 2 &&
            ranked.some(value => value.interestScore === 0 && !selected.includes(value))) continue;
        selected.push(entry);
        if (selected.length === limit) break;
    }
    // If exploration options overlapped, fill the remaining slots with compatible personal themes.
    for (const entry of ranked) {
        if (selected.length >= limit) break;
        if (!selected.includes(entry) && entry.topic.titles[language] && !tooSimilar(entry.topic)) selected.push(entry);
    }
    const shown = new Set();
    return selected.map(({ topic, interestScore }) => {
        const items = [...topic.items].sort((a, b) => Number(shown.has(a._id)) - Number(shown.has(b._id))).slice(0, 4);
        items.forEach(item => shown.add(item._id));
        return { id: topic.id, title: topic.titles[language], query: topic.queries[language],
            personalized: interestScore > 0, origin: topic.searchScore > 0 ? 'search' : 'catalog', count: topic.ids.size, items };
    });
}

module.exports = { buildDiscoveryTopics, selectDiscoveryTopics, parseTopicInterests, searchConcepts };
