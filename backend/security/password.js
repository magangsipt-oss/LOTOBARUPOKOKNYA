export function passwordValidationError(password, sid = '') {
  if (typeof password !== 'string' || password.length < 12) return 'Kata sandi minimal 12 karakter.';
  if (Buffer.byteLength(password) > 72) return 'Kata sandi maksimal 72 byte.';
  if (sid && password.toLocaleLowerCase() === String(sid).toLocaleLowerCase()) return 'Kata sandi tidak boleh sama dengan SID.';
  return null;
}
