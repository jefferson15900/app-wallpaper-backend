const mongoose = require('mongoose');
const UserSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    profilePic: { type: String, default: "" },
    profilePicId: { type: String, default: "" }, 
    role: { type: String, default: "artist" },
    isVerified: { type: Boolean, default: false },
    isVerificationPending: { type: Boolean, default: false },
    instagram: { type: String, default: "" },
    facebook: { type: String, default: "" },
    twitter: { type: String, default: "" },
    tiktok: { type: String, default: "" },  
    web: { type: String, default: "" },
    bio: { type: String, default: "", maxLength: 60 },
    pushToken: { type: String, default: "" },
    lastNotificationSentAt: { type: Date, default: null },
    followers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    following: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],


});
module.exports = mongoose.model('User', UserSchema);