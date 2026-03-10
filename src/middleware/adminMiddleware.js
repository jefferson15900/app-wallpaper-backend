const User = require('../models/User');

module.exports = async (req, res, next) => {
    try {
        // req.user viene del authMiddleware previo
        const user = await User.findById(req.user.id);

        if (user && user.role === 'admin') {
            next(); // Si es admin, permite pasar a la función del controlador
        } else {
            return res.status(403).json({ msg: 'Acceso denegado: Se requiere rol de Administrador' });
        }
    } catch (err) {
        res.status(500).send('Error de servidor en validación de rango');
    }
};