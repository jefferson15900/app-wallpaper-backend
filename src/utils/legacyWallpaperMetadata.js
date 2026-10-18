const { randomUUID } = require('node:crypto');
const { ALIASES, normalizeTerm, normalizeMetadata, resolveMetadataAlias, searchTagsFor } = require('./wallpaperMetadata');

const MIGRATION_VERSION = 'legacy-tags-v1';
const SNAPSHOT_FIELDS = ['tags', 'manualTags', 'metadata', 'metadataVersion', 'metadataRevision', 'images', 'metadataMigration', 'imageUrl', 'public_id', 'status'];

// Exact existing labels only. Franchise names and ambiguous names stay extraTags.
const CHARACTERS = new Set((
    'gojo|2b|reze|hinata hyuga|makima|gwen stacy|hatsune miku|ichigo kurosaki|toji fushiguro|rimuru tempest|jack skellington|frieren|iron man|rukia kuchiki|venom|stitch|vegeta|yoruichi shihouin|alucard|dante|nelliel tu odelschwanck|erza scarlet|bayonetta|princess peach|senku ishigami|a2|goku|miles morales|captain america|shinra kusakabe|leon s kennedy|momo ayase|natsu dragneel|ada wong|bulma|luigi|luffy|ainz ooal gown|obito|batman|ken takakura|mario|itachi|pikachu|furina|snoopy|tamamo cross|zoro|aloy|charizard|toothless|deadpool|doraemon|kakashi|nick wilde|sukuna|aira shiratori|android 18|ellen joe|feixiao|jinx|madara|superman|acheron|buzz lightyear|carlotta|david martinez|jane doe|raiden shogun|red hood|spongebob|akaza|baymax|groot|judy hopps|kurumi tokisaki|light fury|miyabi hoshimi|sakura haruno|wanda maximoff|wolverine|yae miko|yelan|aki hayakawa|arlecchino|evelyn chevalier|ganyu|grimmjow|harry potter|himiko toga|jin enjoji|marin kitagawa|mitsuri kanroji|nezuko|nobara kugisaki|oggy|rapi|rikka takanashi|sailor neptune|sailor pluto|sailor uranus|sanji|sasuke|seiko ayase|soifon|tanjiro|varesa|woody|zenitsu|ai hoshino|aku aku|astra yao|asuna|benimaru shinmon|chen qianyu|citlali|corin wicke|daffy duck|darkrai|donald duck|eula|forky|gaara|homer simpson|hu tao|ino yamanaka|jingliu|jiraiya|kasane teto|killua zoldyck|kisuke urahara|kyoka jiro|lelouch lamperouge|light yagami|mahito|maki zenin|master roshi|mickey mouse|mikasa ackerman|muzan kibutsuji|nezuko kamado|nicole demara|nilou|ochaco uraraka|sailor jupiter|sailor mars|sailor mercury|sailor venus|shikamaru|silver wolf|suguro geto|suigintou|sulley|tai lung|tengen uzui|thanos|thomas shelby|tifa lockhart|tsunade|tweety|ukinami yuzuha|vivian banshee|yi xuan|yoichi isagi|zero two'
).split('|'));
const EXTRA_SUBJECTS = new Set(('sports car|skull|superhero|headphone|hexagon|cube|keyboard|male angel|devil girl|vampire girl|samurai|samurai girl|skull girl|motorcycle|rabbit|eye|ghost|coffee|duck|island|mouse|panda|tree|controller|plants|tiger|fish|glasses|hoodie|lion|monster|road|shapes|sneaker|sportbike|apple|archer|bear|bird|boat|bunny|chameleon|cloud|clown|dinosaur|dolphin|door|fox|giraffe|guitar|hat|heart|house|jellyfish|katana|knight|leopard|map|monkey|palm|penguin|pumpkin|rocks|room|skateboard|square|star|suit|toy|turtle|umbrella|vampire|vehicle|warrior|wheel|wolf|zebra').split('|'));
const EXTRA_STYLES = new Set(['geometric', 'vaporwave', 'chibi', 'gradient', 'graffiti', 'fractal', 'monochrome']);
const EXTRA_COLORS = new Set(['beige', 'mint', 'teal']);
const COMPOSITES = {
    'anime girl': { styles: ['anime'], subjects: ['girl'] },
    'gaming girl': { styles: ['gaming'], subjects: ['girl'] },
    'cyberpunk girl': { styles: ['cyberpunk'], subjects: ['girl'] },
    'vector landscape': { styles: ['vector'], subjects: ['landscape'] },
};

function classifyLegacyTag(tag) {
    const term = normalizeTerm(tag);
    if (Object.hasOwn(COMPOSITES, term)) { return { metadata: COMPOSITES[term], review: false }; }
    const matches = [];
    for (const [field, dictionary] of Object.entries(ALIASES)) {
        const entry = Object.entries(dictionary).find(([canonical, aliases]) => canonical === term || aliases.includes(term));
        if (entry) { matches.push({ [field]: [entry[0]] }); }
    }
    if (matches.length === 1) { return { metadata: matches[0], review: false }; }
    if (CHARACTERS.has(term)) { return { metadata: { characters: [term] }, review: false }; }
    if (EXTRA_SUBJECTS.has(term)) { return { metadata: { subjects: [term] }, review: false }; }
    if (EXTRA_STYLES.has(term)) { return { metadata: { styles: [term] }, review: false }; }
    if (EXTRA_COLORS.has(term)) { return { metadata: { colors: [term] }, review: false }; }
    return { metadata: { extraTags: [term] }, review: true };
}

function snapshotFields(record, fields = SNAPSHOT_FIELDS) {
    return Object.fromEntries(fields.filter(field => Object.hasOwn(record, field)).map(field => [field, record[field]]));
}

function planLegacyWallpaper(record, runId, now = new Date()) {
    if (record.metadataVersion === 1 || record.metadataMigration) { return { skip: 'already_structured' }; }
    if (!Array.isArray(record.tags) || !record.tags.length || record.tags.some(tag => typeof tag !== 'string' || !tag.trim())) {
        return { skip: 'missing_or_invalid_tags' };
    }
    if (record.metadata && Object.keys(record.metadata).length || record.images?.some(image => image.metadata && Object.keys(image.metadata).length || image.aiMetadata && Object.keys(image.aiMetadata).length)) {
        return { skip: 'existing_metadata_requires_review' };
    }
    const metadata = {};
    const reviewTags = [];
    for (const tag of record.tags) {
        const result = classifyLegacyTag(tag);
        if (result.review) { reviewTags.push(tag); }
        for (const [field, values] of Object.entries(result.metadata)) {
            metadata[field] = [...new Set([...(metadata[field] || []), ...values])];
        }
    }
    let normalized;
    try { normalized = normalizeMetadata(metadata); }
    catch { return { skip: 'field_limit_or_invalid_value', reviewTags: record.tags }; }
    const images = record.images?.length ? record.images : [{ imageUrl: record.imageUrl, public_id: record.public_id }];
    if (images.some(image => ['pending', 'processing'].includes(image.analysis?.status))) { return { skip: 'ai_in_progress' }; }
    const scope = images.length === 1 ? 'image' : 'publication';
    const after = { manualTags: record.manualTags ?? [...record.tags], metadataVersion: 1, metadataRevision: (record.metadataRevision || 0) + 1,
        metadataMigration: { version: MIGRATION_VERSION, runId, migratedAt: now, scope },
    };
    if (scope === 'image') {
        if (!images[0].imageUrl) { return { skip: 'missing_image_url' }; }
        after.images = [{ ...images[0], assetId: images[0].assetId || randomUUID(), metadata: normalized,
            analysis: images[0].analysis || { status: 'not_requested' },
        }];
    } else { after.metadata = normalized; }
    after.tags = [...new Set(searchTagsFor({ ...record, ...after }).map(tag => resolveMetadataAlias(tag) ?? normalizeTerm(tag)))];
    const searchable = new Set(after.tags.map(tag => resolveMetadataAlias(tag) ?? normalizeTerm(tag)));
    if (!record.tags.every(tag => searchable.has(resolveMetadataAlias(tag) ?? normalizeTerm(tag)))) {
        throw new Error('Migration would lose an existing searchable tag.');
    }
    return { id: record._id, before: snapshotFields(record), after, scope, reviewTags, assignments: normalized };
}

function snapshotFilter(id, values, fields) {
    return { _id: id, ...Object.fromEntries(fields.map(field => [field, Object.hasOwn(values, field) ? { $eq: values[field] } : { $exists: false }])) };
}

function rollbackUpdate(entry) {
    const fields = Object.keys(entry.after);
    const set = snapshotFields(entry.before, fields);
    const unset = Object.fromEntries(fields.filter(field => !Object.hasOwn(entry.before, field)).map(field => [field, '']));
    return { ...(Object.keys(set).length ? { $set: set } : {}), ...(Object.keys(unset).length ? { $unset: unset } : {}) };
}

module.exports = { MIGRATION_VERSION, SNAPSHOT_FIELDS, classifyLegacyTag, snapshotFields, planLegacyWallpaper, snapshotFilter, rollbackUpdate };
