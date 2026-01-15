const mongoose = require('mongoose');
const connectDB = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('✅ MongoDB Conectado');
    } catch (err) {
        console.error('❌ Error DB:', err.message);
        process.exit(1);
    }
};
module.exports = connectDB;