'use strict';
const crypto = require('crypto');
const multer = require('multer');
const { put, del } = require('@vercel/blob');
const config = require('./config');

const EXT_BY_MIME = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };
const uploader = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.limits.maxImageBytes }
}).single('image');

function hasImageSignature(buffer) {
  const jpeg = buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  const png = buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const webp = buffer.subarray(0, 4).toString('latin1') === 'RIFF' && buffer.subarray(8, 12).toString('latin1') === 'WEBP';
  return jpeg || png || webp;
}

function imageUpload(req, res, next) {
  uploader(req, res, async error => {
    if (error) {
      const message = error.code === 'LIMIT_FILE_SIZE'
        ? 'Cada imagen puede pesar como máximo 4 MB.'
        : 'No se pudo recibir la imagen.';
      return res.status(400).json({ error: message });
    }
    const file = req.file;
    if (!file) return res.status(400).json({ error: 'Seleccione una imagen.' });
    const extension = EXT_BY_MIME[file.mimetype];
    if (!extension || !hasImageSignature(file.buffer)) {
      return res.status(400).json({ error: 'El archivo no es una imagen JPG, PNG o WebP válida.' });
    }
    try {
      const blob = await put(
        `product-images/${crypto.randomBytes(16).toString('hex')}${extension}`,
        file.buffer,
        { access: 'public', contentType: file.mimetype }
      );
      req.uploadedImage = { url: blob.url, pathname: blob.pathname };
      next();
    } catch (uploadError) {
      next(uploadError);
    }
  });
}

async function removeFiles(urls = []) {
  const validUrls = urls.filter(url => isManagedImageUrl(url));
  if (validUrls.length) await del(validUrls);
}

function isManagedImageUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' &&
      url.hostname.endsWith('public.blob.vercel-storage.com') &&
      url.pathname.startsWith('/product-images/');
  } catch {
    return false;
  }
}

module.exports = { imageUpload, removeFiles, isManagedImageUrl };
