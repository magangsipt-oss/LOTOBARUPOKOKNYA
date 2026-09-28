export function validDeviceCredential(token) {
  return typeof token === 'string' && token.length >= 32 && token.length <= 256 &&
    !token.startsWith('replace-with-') && /^[\x21-\x7e]+$/.test(token);
}
