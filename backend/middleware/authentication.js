/**
 * Middleware untuk validasi otentikasi atau API Key
 */
const authentication = (req, res, next) => {
  // Contoh pengecekan API Key header (opsional jika perangkat IoT mengirim x-api-key)
  const apiKey = req.headers['x-api-key'];

  // Jika ingin mengaktifkan proteksi API Key di .env (misal: API_SECRET_KEY=eloto123)
  if (process.env.API_SECRET_KEY && apiKey) {
    if (apiKey !== process.env.API_SECRET_KEY) {
      return res.status(403).json({
        success: false,
        message: 'Akses ditolak: API Key tidak valid'
      });
    }
  }

  // Lanjut ke controller jika lolos verifikasi
  next();
};

export default authentication;