/**
 * Middleware untuk validasi otentikasi atau API Key
 *
 * 3 mode:
 *   1. x-api-key header  → cocokkan dengan API_SECRET_KEY dari .env
 *   2. Authorization: Bearer <token>  → cocokkan dengan API_SECRET_KEY dari .env
 *   3. Jika API_SECRET_KEY tidak diset di .env → skip (dev mode)
 */
const authentication = (req, res, next) => {
  const secretKey = process.env.API_SECRET_KEY;

  // Jika tidak ada secret key di .env → skip auth (development mode)
  if (!secretKey) return next();

  // Cek x-api-key header (ESP32 style)
  const apiKey = req.headers['x-api-key'];
  if (apiKey && apiKey === secretKey) return next();

  // Cek Authorization: Bearer <token> (web frontend style)
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    if (token === secretKey) return next();
  }

  // Cek X-Device-Token header (ESP32 alternative)
  const deviceToken = req.headers['x-device-token'];
  if (deviceToken && deviceToken === secretKey) return next();

  return res.status(401).json({
    success: false,
    message: 'Akses ditolak: API Key tidak valid. Sertakan header x-api-key atau Authorization Bearer.'
  });
};

export default authentication;
