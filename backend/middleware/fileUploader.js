import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 1. Menentukan lokasi penyimpanan file upload
const uploadDir = path.join(__dirname, '..', 'uploads', 'user_profiles');

// Pastikan folder penyimpanan sudah ada, jika belum maka buat otomatis
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// 2. Konfigurasi tempat penyimpanan dan penamaan file
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    // Format nama: USER-timestamp-angkaRandom.ekstensi
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, 'USER-' + uniqueSuffix + path.extname(file.originalname));
  }
});

// 3. Filter jenis file: hanya menerima gambar (jpg, jpeg, png)
const fileFilter = (req, file, cb) => {
  const allowedFileTypes = /jpeg|jpg|png|webp/;
  const extname = allowedFileTypes.test(path.extname(file.originalname).toLowerCase());
  const mimetype = allowedFileTypes.test(file.mimetype);

  if (extname && mimetype) {
    return cb(null, true);
  } else {
    cb(new Error('Format file tidak didukung! Hanya file gambar (JPG, PNG, WEBP) yang diizinkan.'));
  }
};

// 4. Inisialisasi Multer dengan batas ukuran maksimal 5 MB
const upload = multer({
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 Megabytes
  fileFilter: fileFilter
});

export default upload;