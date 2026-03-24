const jwt = require('jsonwebtoken');
const User = require('../models/User');

module.exports = (req, res, next) => {
    const token = req.header('x-auth-token');
    if (!token) return res.status(401).json({ msg: 'No hay token, permiso denegado' });

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded.user;
        User.findByIdAndUpdate(req.user.id, { lastActiveAt: new Date() }).catch(err => console.log("Error tracking:", err));
        next();
    } catch (err) {
        res.status(401).json({ msg: 'Token no válido' });
    }
};