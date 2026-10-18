const { isDeepStrictEqual } = require('node:util');
const { normalizeTerm, normalizeMetadata, searchTagsFor } = require('./wallpaperMetadata');
const { SNAPSHOT_FIELDS, snapshotFields } = require('./legacyWallpaperMetadata');

const MIGRATION_VERSION = 'franchises-v1';
// Existing title labels only: no franchise is inferred from a character or an image.
const TITLES = [
    'chainsaw man', 'bleach', 'jujutsu kaisen', 'naruto shippuden', 'nier automata', 'super mario bros', 'dragon ball',
    'the nightmare before christmas', 'fairy tail', 'one piece', 'genshin impact', 'wuthering waves', 'zenless zone zero',
    'blue archive', 'dan da dan', 'pokemon', 'final fantasy', 'firewatch', 'hollow knight', 'rozen maiden', 'stellar blade',
    'overlord', 'hellsing', 'devil may cry', 'horizon zero dawn', 'resident evil', 'death note', 'the powerpuff girls',
    'ed edd n eddy', 'fire force', 'regular show', 'god of war', 'sword art online', 'darling in the franxx',
    'sakamoto days', 'hunter x hunter', 'blue lock', 'tom and jerry', 'zootopia', 'angry birds', 'courage the cowardly dog',
];
const FRANCHISE_NAMES = new Map(TITLES.map(title => [title, title]));
const ALTERNATE_TITLES = {
    chainsawman: 'chainsaw man', dragonball: 'dragon ball', pokemon: 'pokemon', 'pokémon': 'pokemon',
    'honkai star rail': 'honkai: star rail', 'honkai: star rail': 'honkai: star rail',
    'tensei shitara slime datta ken': 'that time i got reincarnated as a slime',
    'that time i got reincarnated as a slime': 'that time i got reincarnated as a slime',
    'frieren beyond journeys end': "frieren: beyond journey's end", "frieren: beyond journey's end": "frieren: beyond journey's end",
    'boku no hero academia': 'my hero academia', 'my hero academia': 'my hero academia',
    drstone: 'dr. stone', 'dr stone': 'dr. stone', 'dr. stone': 'dr. stone',
    'oshi ko': 'oshi no ko', 'oshi no ko': 'oshi no ko',
    nte: 'neverness to everness', 'neverness to everness': 'neverness to everness',
    endfield: 'arknights: endfield', 'arknights endfield': 'arknights: endfield', 'arknights: endfield': 'arknights: endfield',
    nikke: 'goddess of victory: nikke', 'goddess of victory: nikke': 'goddess of victory: nikke',
    umamusume: 'umamusume: pretty derby', 'umamusume: pretty derby': 'umamusume: pretty derby',
    'stranger thing': 'stranger things', 'stranger things': 'stranger things',
    gta: 'grand theft auto', 'gta vi': 'grand theft auto vi',
    'demon slayer': 'demon slayer: kimetsu no yaiba', 'demon slayer: kimetsu no yaiba': 'demon slayer: kimetsu no yaiba',
    yugioh: 'yu-gi-oh!', 'yu-gi-oh!': 'yu-gi-oh!',
    'coraje perro cobarde': 'courage the cowardly dog',
};
for (const [alias, title] of Object.entries(ALTERNATE_TITLES)) { FRANCHISE_NAMES.set(normalizeTerm(alias), title); }

function moveFranchises(metadata, assignments, reviewTags) {
    if (!metadata || !Array.isArray(metadata.extraTags)) { return metadata; }
    // An explicit empty manual franchise field is a user's override, not missing data.
    if (Array.isArray(metadata.franchises) && !metadata.franchises.length) { return metadata; }
    const added = [], remaining = [];
    for (const tag of metadata.extraTags) {
        const title = typeof tag === 'string' && FRANCHISE_NAMES.get(normalizeTerm(tag));
        if (title) { added.push(title); }
        else { remaining.push(tag); reviewTags.push(tag); }
    }
    if (!added.length) { return metadata; }
    const franchises = normalizeMetadata({ franchises: [...new Set([...(metadata.franchises || []), ...added])] }).franchises;
    assignments.franchises.push(...added);
    return { ...metadata, franchises, extraTags: remaining };
}

function planFranchiseWallpaper(record, runId) {
    if (record.images?.some(image => ['pending', 'processing'].includes(image.analysis?.status))) { return { skip: 'ai_in_progress' }; }
    const assignments = { franchises: [] }, reviewTags = [];
    let metadata, images;
    try {
        metadata = moveFranchises(record.metadata, assignments, reviewTags);
        images = record.images?.map(image => ({ ...image, ...(image.metadata
            ? { metadata: moveFranchises(image.metadata, assignments, reviewTags) } : {}) }));
    } catch { return { skip: 'field_limit_or_invalid_value' }; }
    if (!assignments.franchises.length) { return { skip: 'no_missing_franchise', reviewTags }; }
    const after = { metadataRevision: (record.metadataRevision || 0) + 1 };
    if (!isDeepStrictEqual(metadata, record.metadata)) { after.metadata = metadata; }
    if (!isDeepStrictEqual(images, record.images)) { after.images = images; }
    // Keep every original search value as well as canonical English title spellings.
    after.tags = [...new Set([...(record.tags || []), ...searchTagsFor({ ...record, ...after })])];
    return { id: record._id, runId, before: snapshotFields(record), after,
        scope: after.images ? 'image' : 'publication', assignments, reviewTags: [...new Set(reviewTags)] };
}

module.exports = { MIGRATION_VERSION, SNAPSHOT_FIELDS, planLegacyWallpaper: planFranchiseWallpaper, FRANCHISE_NAMES };
