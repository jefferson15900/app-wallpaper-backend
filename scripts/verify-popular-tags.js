require('dotenv').config();
const mongoose = require('mongoose');
const TagSuggestion = require('../src/models/TagSuggestion');
const { getPopularTags } = require('../src/controllers/wallpaperController');

async function test() {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('✅ Connected to MongoDB');

        // Mock req and res objects
        const req = {};
        const res = {
            json: function(data) {
                console.log('📬 Response Data (Popular Tags):', data);
                if (Array.isArray(data) && data.length > 0) {
                    console.log('✅ Success! Found popular tags.');
                } else {
                    console.error('❌ Failed: Return value is not a valid non-empty array.');
                }
                mongoose.connection.close();
            },
            status: function(code) {
                console.log('Status code set to:', code);
                return this;
            }
        };

        // Call controller
        await getPopularTags(req, res);

    } catch (err) {
        console.error('Error in test script:', err);
        process.exit(1);
    }
}

test();
