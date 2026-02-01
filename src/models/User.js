const mongoose = require('mongoose');
const UserSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    profilePic: { type: String, default: "" },
    profilePicId: { type: String, default: "" }, 
    role: { type: String, default: "artist" },
    instagram: { type: String, default: "" },
    facebook: { type: String, default: "" },
    twitter: { type: String, default: "" },
    tiktok: { type: String, default: "" },  
    web: { type: String, default: "" },
    pushToken: { type: String, default: "" },
    lastNotificationSentAt: { type: Date, default: null },
    followers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    following: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
});
module.exports = mongoose.model('User', UserSchema);