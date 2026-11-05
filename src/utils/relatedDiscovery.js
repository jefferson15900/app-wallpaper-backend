// The session seed fixes each batch's quota so retries and pagination keep the same order.
function planRelatedDiscovery(mainCount, discoveryCount, page, limit, seed) {
    let mainSkip = 0;
    let discoverySkip = 0;
    for (let batch = 1; batch <= page; batch++) {
        let random = Math.imul(seed ^ batch, 0x45d9f3b) >>> 0;
        random = (random ^ (random >>> 16)) >>> 0;
        const availableMain = mainCount - mainSkip;
        const availableDiscovery = discoveryCount - discoverySkip;
        const quota = Math.min(1 + random % 2, limit - 1);
        const discoveryTake = Math.min(quota, availableDiscovery);
        const mainTake = Math.min(limit - discoveryTake, availableMain);
        if (batch === page || mainTake + discoveryTake === 0) {
            return { mainSkip, discoverySkip, mainTake, discoveryTake };
        }
        mainSkip += mainTake;
        discoverySkip += discoveryTake;
    }
}

function mixRelatedDiscovery(main, discovery) {
    const result = [...main];
    discovery.forEach((item, index) => result.splice(Math.min(3 + index * 4, result.length), 0, item));
    return result;
}

module.exports = { planRelatedDiscovery, mixRelatedDiscovery };
