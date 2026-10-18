const { createHash } = require('node:crypto');

function searchKey(query, type, premium, exclude) {
    return createHash('sha256').update(JSON.stringify([query, type || 'all', premium === 'true', exclude || ''])).digest('hex');
}

function readSearchCursor(value, key) {
    if (value === undefined) { return null; }
    try {
        if (typeof value !== 'string' || value.length > 1024 || !/^[A-Za-z0-9_-]+$/.test(value)) { throw new Error(); }
        const cursor = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
        if (cursor?.v !== 1 || cursor.key !== key || !['exact', 'fuzzy'].includes(cursor.mode) ||
            !Number.isFinite(cursor.seed) || cursor.seed < 0 || cursor.seed >= 1 ||
            !Number.isFinite(cursor.score) || cursor.score < 0 ||
            typeof cursor.id !== 'string' || !/^[a-f0-9]{24}$/.test(cursor.id)) { throw new Error(); }
        return cursor;
    } catch {
        throw Object.assign(new Error('La continuación de búsqueda no es válida. Inicia la búsqueda de nuevo.'), { statusCode: 400 });
    }
}

function nextSearchCursor(item, key, seed, mode) {
    return Buffer.from(JSON.stringify({ v: 1, key, seed, mode, score: item.randomizedScore, id: String(item._id) })).toString('base64url');
}

module.exports = { searchKey, readSearchCursor, nextSearchCursor };
