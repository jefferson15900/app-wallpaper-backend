const isId = value => typeof value === 'string' && /^[a-f\d]{24}$/i.test(value);

function validateUpdate(body = {}) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'La actualización no es válida.' };
    const { text, wallpaperIds, coverWallpaperId } = body;
    if (typeof text !== 'string' || !text.trim() || text.trim().length > 160) {
        return { error: 'Escribe un texto de entre 1 y 160 caracteres.' };
    }
    if (!Array.isArray(wallpaperIds) || !wallpaperIds.length || wallpaperIds.length > 100 || !wallpaperIds.every(isId)) {
        return { error: 'Selecciona entre 1 y 100 wallpapers válidos.' };
    }
    const ids = [...new Set(wallpaperIds)];
    if (!isId(coverWallpaperId) || !ids.includes(coverWallpaperId)) {
        return { error: 'La portada debe ser uno de los wallpapers seleccionados.' };
    }
    return { value: { text: text.trim(), wallpaperIds: ids, coverWallpaperId } };
}
module.exports = { validateUpdate, isId };
