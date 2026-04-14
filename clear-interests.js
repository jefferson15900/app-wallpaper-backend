require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('./src/config/db');
const User = require('./src/models/User');

const clearAllInterests = async () => {
    await connectDB();
    try {
        // Ponemos el mapa de intereses vacío para TODOS los usuarios
        const result = await User.updateMany({}, { $set: { interests: {} } });
        console.log(`✅ Se han reseteado los intereses de ${result.modifiedCount} usuarios.`);
        process.exit(0);
    } catch (e) {
        console.log(e);
        process.exit(1);
    }
};

clearAllInterests();