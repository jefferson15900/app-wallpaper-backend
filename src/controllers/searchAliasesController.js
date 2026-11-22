const TagMap = require('../models/TagMap');
const { LOCAL_TAG_ALIASES, resolveLocalTag } = require('../config/tags');
const { normalizeSearchText, IGNORED_SEARCH_WORDS } = require('../utils/searchQuery');
const { isId } = require('../utils/updateValidation');

const PAGE_SIZE = 40;

function term(value) {
    if (typeof value !== 'string' || value.length > 160) { return ''; }
    const normalized = normalizeSearchText(value);
    return normalized.length >= 2 && normalized.length <= 80 && /[\p{L}\p{N}]/u.test(normalized) &&
        !normalized.split(' ').every(word => IGNORED_SEARCH_WORDS.has(word)) ? normalized : '';
}

function view(row) {
    return { id: String(row._id), original: row.original, canonical: row.canonical,
        locked: LOCAL_TAG_ALIASES.has(row.original) || row.original === row.canonical };
}

function failure(res, error) {
    return res.status(error.code === 11000 ? 409 : 500).json({ msg: error.code === 11000
        ? 'Ese nombre ya está registrado. Búscalo para editarlo.'
        : 'No se pudo completar la operación. Actualiza la lista y vuelve a intentar.' });
}

exports.list = async (req, res) => {
    const query = typeof req.query.q === 'string' ? normalizeSearchText(req.query.q) : '';
    const selectedTag = req.query.tag === undefined ? '' : term(req.query.tag);
    const page = Number(req.query.page || 1);
    if ((req.query.tag !== undefined && !selectedTag) || query.length > 80 || !Number.isInteger(page) || page < 1 || page > 50000) {
        return res.status(400).json({ msg: 'Usa una búsqueda de hasta 80 caracteres y una página válida.' });
    }
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    try {
        let canonical = resolveLocalTag(selectedTag);
        if (selectedTag && !LOCAL_TAG_ALIASES.has(selectedTag)) {
            const mapping = await TagMap.findOne({ original: selectedTag }).lean();
            canonical = resolveLocalTag(mapping?.canonical || selectedTag);
        }
        const filter = selectedTag ? { canonical, original: { $ne: canonical } }
            : query ? { $or: [{ original: { $regex: escaped } }, { canonical: { $regex: escaped } }] } : {};
        const [rows, total] = await Promise.all([
            TagMap.find(filter).sort({ original: 1 }).skip((page - 1) * PAGE_SIZE).limit(PAGE_SIZE).lean(),
            TagMap.countDocuments(filter),
        ]);
        res.json({ aliases: rows.map(view), total, page, pageSize: PAGE_SIZE, ...(selectedTag ? { canonical } : {}) });
    } catch (error) { failure(res, error); }
};

exports.save = async (req, res) => {
    const id = req.params.id;
    const original = term(req.body?.original);
    const rawCanonical = term(req.body?.canonical);
    if ((id && !isId(id)) || !original || !rawCanonical) {
        return res.status(400).json({ msg: 'Completa ambos nombres con entre 2 y 80 caracteres útiles para buscar.' });
    }
    const canonical = resolveLocalTag(rawCanonical);
    if (LOCAL_TAG_ALIASES.has(original)) {
        return res.status(409).json({ msg: 'Este nombre pertenece al diccionario base. Usa otro nombre alternativo.' });
    }
    try {
        const existing = id ? await TagMap.findById(id).lean() : await TagMap.findOne({ original }).lean();
        if (id && !existing) { return res.status(404).json({ msg: 'Este alias ya no existe. Actualiza la lista.' }); }
        if (!id && existing) { return res.status(409).json({ msg: 'Ese nombre ya está registrado. Búscalo para editarlo.' }); }
        if (id && (existing.original !== original || existing.original === existing.canonical)) {
            return res.status(409).json({ msg: 'El nombre del alias y los nombres principales no se pueden modificar. Crea otro alias.' });
        }
        if (original !== canonical && await TagMap.exists({ canonical: original, original: { $ne: original } })) {
            return res.status(409).json({ msg: 'Otros alias usan este nombre como destino. Usa su nombre principal.' });
        }
        // Register the complete principal name as one searchable phrase too.
        if (!LOCAL_TAG_ALIASES.has(canonical)) {
            await TagMap.updateOne({ original: canonical }, { $setOnInsert: { original: canonical, canonical, language: 'en' } }, { upsert: true });
            const target = await TagMap.findOne({ original: canonical }).lean();
            if (target.canonical !== canonical) {
                return res.status(409).json({ msg: `El destino también es un alias. Usa su nombre principal: ${target.canonical}.` });
            }
        }
        const row = id
            ? await TagMap.findOneAndUpdate({ _id: id, original }, { $set: { canonical } }, { new: true, runValidators: true }).lean()
            : await TagMap.findOneAndUpdate({ original }, { $setOnInsert: { original, canonical, language: 'en' } }, { upsert: true, new: true, runValidators: true }).lean();
        if (!row) { return res.status(404).json({ msg: 'Este alias ya no existe. Actualiza la lista.' }); }
        if (row.canonical !== canonical) { return res.status(409).json({ msg: 'Ese nombre ya pertenece a otro destino. Actualiza la lista.' }); }
        res.status(id ? 200 : 201).json({ alias: view(row) });
    } catch (error) { failure(res, error); }
};

exports.remove = async (req, res) => {
    if (!isId(req.params.id)) { return res.status(400).json({ msg: 'El identificador del alias no es válido.' }); }
    try {
        const row = await TagMap.findById(req.params.id).lean();
        if (!row) { return res.status(404).json({ msg: 'Este alias ya no existe. Actualiza la lista.' }); }
        if (view(row).locked || await TagMap.exists({ canonical: row.original, original: { $ne: row.original } })) {
            return res.status(409).json({ msg: 'Este nombre pertenece al diccionario base o es el destino de un grupo. Elimina solo los nombres alternativos.' });
        }
        await TagMap.deleteOne({ _id: row._id });
        res.json({ deleted: true });
    } catch (error) { failure(res, error); }
};
