'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const config = require('./config');

const EXT_BY_MIME = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, config.uploadDir),
  // Nombre aleatorio y extensión según el tipo MIME permitido: se ignora el nombre original del usuario.
  filename: (req, file, cb) => cb(null, crypto.randomBytes(16).toString('hex') + EXT_BY_MIME[file.mimetype])
});

const uploader = multer({
  storage,
  limits: { fileSize: config.limits.maxImageBytes, files: config.limits.maxImagesPerProduct },
  fileFilter: (req, file, cb) =>
    EXT_BY_MIME[file.mimetype] ? cb(null, true) : cb(new Error('Solo se permiten imágenes JPG, PNG o WebP.'))
}).array('images', config.limits.maxImagesPerProduct);

/** Comprueba los primeros bytes del archivo (firma real), no solo el tipo MIME declarado. */
function hasImageSignature(filePath) {
  const fd = fs.openSync(filePath, 'r');
  const b = Buffer.alloc(12);
  fs.readSync(fd, b, 0, 12, 0);
  fs.closeSync(fd);
  const jpeg = b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
  const png = b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const webp = b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP';
  return jpeg || png || webp;
}

function removeFiles(names = []) {
  for (const name of names) {
    try {
      fs.unlinkSync(path.join(config.uploadDir, path.basename(name)));
    } catch {
      /* ya no existe */
    }
  }
}

/** Middleware: procesa "images[]" (multipart) y valida cada archivo. Si es JSON, lo deja pasar. */
function imageUpload(req, res, next) {
  uploader(req, res, err => {
    if (err) {
      removeFiles((req.files || []).map(f => f.filename));
      const msg =
        err.code === 'LIMIT_FILE_SIZE'
          ? 'Cada imagen puede pesar como máximo 5 MB.'
          : err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE'
            ? `Máximo ${config.limits.maxImagesPerProduct} imágenes por producto.`
            : err.message;
      return res.status(400).json({ error: msg });
    }
    const files = req.files || [];
    if (files.some(f => !hasImageSignature(f.path))) {
      removeFiles(files.map(f => f.filename));
      return res.status(400).json({ error: 'Uno de los archivos no es una imagen válida.' });
    }
    next();
  });
}

module.exports = { imageUpload, removeFiles };
