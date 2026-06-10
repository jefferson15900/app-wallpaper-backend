require('dotenv').config();
const mongoose = require('mongoose');
const Wallpaper = require('../src/models/Wallpaper');

async function check() {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('✅ Connected to MongoDB');

        const total = await Wallpaper.countDocuments({});
        console.log('Total wallpapers:', total);

        const approved = await Wallpaper.countDocuments({ status: 'approved' });
        console.log('Approved wallpapers:', approved);

        // Count wallpapers that actually have a category property in MongoDB
        const hasCategory = await Wallpaper.countDocuments({ category: { $exists: true } });
        console.log('Wallpapers with category field:', hasCategory);

        // Let's print some sample category values if any
        if (hasCategory > 0) {
            const samples = await Wallpaper.find({ category: { $exists: true } }).limit(5).lean();
            console.log('Samples with category:', samples.map(s => ({ _id: s._id, tags: s.tags, category: s.category })));
        }

        // Count wallpapers that have tags
        const hasTags = await Wallpaper.countDocuments({ tags: { $exists: true, $not: { $size: 0 } } });
        console.log('Wallpapers with tags:', hasTags);

        // Let's print some sample tags
        const topTags = await Wallpaper.aggregate([
            { $unwind: '$tags' },
            { $group: { _id: '$tags', count: { $sum: 1 } } },
            { $sort: { count: -1 } },
            { $limit: 10 }
        ]);
        console.log('Top tags in DB:', topTags);

        mongoose.connection.close();
    } catch (err) {
        console.error('Error:', err);
        process.exit(1);
    }
}

check();
