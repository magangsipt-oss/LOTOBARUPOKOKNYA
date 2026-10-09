import multer from 'multer';
export default multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 15, fieldSize: 7 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) {
      return cb(Object.assign(new Error('Format gambar tidak valid'), { status: 400 }));
    }
    cb(null, true);
  }
});
