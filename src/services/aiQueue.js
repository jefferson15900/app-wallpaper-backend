const { randomUUID } = require('node:crypto');
const Wallpaper = require('../models/Wallpaper');
const { analyzeImage } = require('./aiService');
const { updateMetadata } = require('./wallpaperMetadataService');

let timer;
let running = false;

async function processNext() {
    if (running) { return; }
    running = true;
    try {
        // An interrupted request may already have been billed. Require manual retry.
        const now = new Date();
        await Wallpaper.updateMany({ images: { $elemMatch: { 'analysis.status': 'processing', 'analysis.leaseUntil': { $lt: now } } } }, {
            $set: { 'images.$[image].analysis.status': 'failed', 'images.$[image].analysis.error': 'El análisis fue interrumpido. Reintenta manualmente si lo deseas.' }, $inc: { metadataRevision: 1 },
        }, { arrayFilters: [{ 'image.analysis.status': 'processing', 'image.analysis.leaseUntil': { $lt: now } }] });
        const runId = randomUUID();
        const wallpaper = await Wallpaper.findOneAndUpdate({ type: 'image', images: { $elemMatch: { assetId: { $exists: true }, 'analysis.status': 'pending' } } }, {
            $set: { 'images.$.analysis.status': 'processing', 'images.$.analysis.runId': runId,
                'images.$.analysis.startedAt': now, 'images.$.analysis.leaseUntil': new Date(now.getTime() + 10 * 60000) },
            $inc: { metadataRevision: 1 },
        }, { new: true }).lean();
        if (!wallpaper) { return; }
        const image = wallpaper.images.find(image => image.analysis?.runId === runId);
        if (!image) { return; }
        let result;
        let failure;
        try { result = await analyzeImage(image.imageUrl); }
        catch (error) { failure = error; }
        await updateMetadata(wallpaper._id, current => {
            const images = current.images.map(asset => {
                if (asset.assetId !== image.assetId || asset.analysis?.runId !== runId || asset.analysis.status !== 'processing') { return asset; }
                return { ...asset, ...(result ? { aiMetadata: result.metadata } : {}), analysis: {
                    status: result ? 'succeeded' : 'failed', model: result?.model,
                    version: result?.version, analyzedAt: new Date(),
                    error: failure ? 'No se pudo analizar. Los datos manuales siguen disponibles.' : undefined,
                } };
            });
            return { images, isAITagged: images.some(asset => asset.analysis?.status === 'succeeded') };
        });
        if (failure) { console.warn('[IA wallpaper] Análisis fallido; no se reintentará automáticamente.'); }
    } catch (error) {
        console.error('[IA wallpaper] No se pudo procesar el trabajo:', error.message);
    } finally { running = false; }
}

function start() {
    if (!timer) { timer = setInterval(processNext, 5000); timer.unref(); void processNext(); }
    return () => { clearInterval(timer); timer = undefined; };
}

// Jobs live in images[].analysis and are saved with the upload, not in memory.
function addJobs() { if (timer) { void processNext(); } }

module.exports = { start, addJobs, processNext };
