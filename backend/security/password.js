export function passwordValidationError(password, sid = '', { allowSidMatch = false } = {}) {
  if (typeof password !== 'string') return 'Kata sandi minimal 12 karakter.';
  if (Buffer.byteLength(password) > 72) return 'Kata sandi maksimal 72 byte.';
  const matchesSid = sid && password.toLocaleLowerCase() === String(sid).toLocaleLowerCase();
  if (matchesSid) return allowSidMatch ? null : 'Kata sandi tidak boleh sama dengan SID.';
  if (password.length < 12) return 'Kata sandi minimal 12 karakter.';
  return null;
}
