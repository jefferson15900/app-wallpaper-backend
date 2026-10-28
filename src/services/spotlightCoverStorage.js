exports.upload = buffer => new Promise((resolve, reject) => {
    const { cloudinaryPrimary } = require('../config/cloudinary');
    cloudinaryPrimary.uploader.upload_stream({ folder: 'banner_covers', resource_type: 'image',
        transformation: [{ width: 1600, crop: 'limit' }, { quality: 'auto:good' }, { fetch_format: 'auto' }],
    }, (error, result) => error ? reject(error) : resolve(result)).end(buffer);
});

exports.remove = async publicId => {
    const { cloudinaryPrimary } = require('../config/cloudinary');
    await cloudinaryPrimary.uploader.destroy(publicId, { resource_type: 'image' });
};
