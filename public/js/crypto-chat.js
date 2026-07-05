/**
 * End-to-end encrypted chat for a room.
 * Key is derived from the meeting code — only participants with the code can decrypt.
 */
window.MeetCrypto = (() => {
  let roomKey = null;

  async function initRoomKey(roomId) {
    if (!window.crypto?.subtle) return false;
    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      enc.encode(`meetapp-v1:${roomId}`),
      'PBKDF2',
      false,
      ['deriveKey'],
    );
    roomKey = await crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: enc.encode('meetapp-chat-salt-v1'),
        iterations: 100000,
        hash: 'SHA-256',
      },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    );
    return true;
  }

  function isReady() {
    return Boolean(roomKey);
  }

  async function encryptText(plain) {
    if (!roomKey) throw new Error('Encryption not initialized');
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const cipher = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      roomKey,
      new TextEncoder().encode(plain),
    );
    return {
      v: 1,
      iv: arrayBufferToBase64(iv),
      data: arrayBufferToBase64(cipher),
    };
  }

  async function decryptPayload(payload) {
    if (!payload || payload.legacy) return payload?.legacy || '';
    if (!roomKey || !payload.data) return '[Encrypted message]';
    try {
      const iv = base64ToArrayBuffer(payload.iv);
      const data = base64ToArrayBuffer(payload.data);
      const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, roomKey, data);
      return new TextDecoder().decode(plain);
    } catch {
      return '[Unable to decrypt message]';
    }
  }

  function arrayBufferToBase64(buf) {
    const bytes = new Uint8Array(buf);
    let binary = '';
    bytes.forEach((b) => { binary += String.fromCharCode(b); });
    return btoa(binary);
  }

  function base64ToArrayBuffer(b64) {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  return { initRoomKey, isReady, encryptText, decryptPayload };
})();
