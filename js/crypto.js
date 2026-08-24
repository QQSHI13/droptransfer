/**
 * Encryption/Decryption utilities with error handling
 *
 * Threat model
 * ------------
 * WebRTC already encrypts data in transit with DTLS, so the application-layer
 * AES-GCM here exists to protect against the *signaling server* and anyone else
 * who can observe or tamper with signaling — parties that DTLS does not defend
 * against, because they can substitute connection fingerprints.
 *
 * That only works if the key comes from a secret the signaling server never
 * sees. Peer IDs do not qualify: they are assigned and relayed by that very
 * server, and the sender's peer ID is the share code itself. So the key is
 * derived from a locally-generated random secret that travels only in the
 * fragment of the share link, out of band of signaling.
 */

const ENCRYPTION_ALGORITHM = 'AES-GCM';
const KEY_DERIVATION_ALGORITHM = 'HKDF';

// Bytes of entropy in the shared secret. 16 bytes is a 128-bit key, encoded as
// 22 base64url characters — short enough to read aloud or retype.
const SECRET_BYTES = 16;

// Domain-separation label, so this key cannot collide with a key derived from
// the same secret for some other purpose later.
const HKDF_INFO = 'droptransfer/v1 file-chunk encryption';

/**
 * Check if crypto API is available
 * @returns {boolean}
 */
export function isCryptoSupported() {
    return typeof crypto !== 'undefined' &&
           crypto.subtle &&
           typeof crypto.getRandomValues === 'function';
}

/**
 * Encode bytes as base64url (no padding), safe for use in a URL fragment.
 * @param {Uint8Array} bytes
 * @returns {string}
 */
function toBase64Url(bytes) {
    let binary = '';
    for (const b of bytes) {
        binary += String.fromCharCode(b);
    }
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Decode a base64url string back to bytes.
 * @param {string} value
 * @returns {Uint8Array}
 * @throws {Error} If the value is not valid base64url
 */
function fromBase64Url(value) {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}

/**
 * Generate the shared secret that keys a transfer.
 *
 * This value must reach the receiver out of band (it rides in the fragment of
 * the share link, which browsers never transmit) and must never be sent over
 * the signaling channel.
 *
 * @returns {string} base64url-encoded secret
 * @throws {Error} If crypto is not supported
 */
export function generateSecret() {
    if (!isCryptoSupported()) {
        throw new Error('Web Crypto API not supported in this browser');
    }
    return toBase64Url(crypto.getRandomValues(new Uint8Array(SECRET_BYTES)));
}

/**
 * Check that a value looks like a secret produced by generateSecret().
 * @param {*} secret
 * @returns {boolean}
 */
export function isValidSecret(secret) {
    if (typeof secret !== 'string') return false;
    // 16 bytes base64url-encodes to exactly 22 unpadded characters.
    if (!/^[A-Za-z0-9_-]{22}$/.test(secret)) return false;
    try {
        return fromBase64Url(secret).length === SECRET_BYTES;
    } catch {
        return false;
    }
}

/**
 * Derive the transfer key from the shared secret.
 *
 * The peer IDs are mixed in as the HKDF salt so that the key is bound to this
 * specific pair of peers; they are public, which is fine — the secrecy comes
 * entirely from `secret`.
 *
 * @param {string} secret - base64url secret from generateSecret()
 * @param {string} peerId1 - First peer ID
 * @param {string} peerId2 - Second peer ID
 * @returns {Promise<CryptoKey>} Derived key
 * @throws {Error} If crypto is not supported or derivation fails
 */
export async function deriveKey(secret, peerId1, peerId2) {
    if (!isCryptoSupported()) {
        throw new Error('Web Crypto API not supported in this browser');
    }

    if (!isValidSecret(secret)) {
        throw new Error('Missing or malformed transfer secret');
    }

    if (!peerId1 || !peerId2) {
        throw new Error('Both peer IDs are required for key derivation');
    }

    try {
        const encoder = new TextEncoder();
        // Sorted so both ends derive the same key regardless of who is sending.
        const salt = encoder.encode([peerId1, peerId2].sort().join('|'));

        const keyMaterial = await crypto.subtle.importKey(
            'raw',
            fromBase64Url(secret),
            { name: KEY_DERIVATION_ALGORITHM },
            false,
            ['deriveKey']
        );

        return await crypto.subtle.deriveKey(
            {
                name: KEY_DERIVATION_ALGORITHM,
                hash: 'SHA-256',
                salt: salt,
                info: encoder.encode(HKDF_INFO)
            },
            keyMaterial,
            { name: ENCRYPTION_ALGORITHM, length: 256 },
            false,
            ['encrypt', 'decrypt']
        );
    } catch (err) {
        console.error('[Crypto] Key derivation failed:', err);
        throw new Error(`Failed to derive encryption key: ${err.message}`);
    }
}

/**
 * Encrypt a chunk of data
 * @param {CryptoKey} key - Encryption key
 * @param {ArrayBuffer} data - Data to encrypt
 * @param {Uint8Array} iv - Initialization vector
 * @returns {Promise<ArrayBuffer>} Encrypted data
 * @throws {Error} If encryption fails
 */
export async function encryptChunk(key, data, iv) {
    if (!key || !data || !iv) {
        throw new Error('Key, data, and IV are required for encryption');
    }

    try {
        return await crypto.subtle.encrypt(
            { name: ENCRYPTION_ALGORITHM, iv: iv },
            key,
            data
        );
    } catch (err) {
        console.error('[Crypto] Encryption failed:', err);
        throw new Error(`Encryption failed: ${err.message}`);
    }
}

/**
 * Decrypt a chunk of data
 * @param {CryptoKey} key - Decryption key
 * @param {ArrayBuffer} encryptedData - Encrypted data
 * @param {Uint8Array} iv - Initialization vector
 * @returns {Promise<ArrayBuffer>} Decrypted data
 * @throws {Error} If decryption fails
 */
export async function decryptChunk(key, encryptedData, iv) {
    if (!key || !encryptedData || !iv) {
        throw new Error('Key, encrypted data, and IV are required for decryption');
    }

    try {
        return await crypto.subtle.decrypt(
            { name: ENCRYPTION_ALGORITHM, iv: iv },
            key,
            encryptedData
        );
    } catch (err) {
        console.error('[Crypto] Decryption failed:', err);
        throw new Error(`Decryption failed - data may be corrupted: ${err.message}`);
    }
}

/**
 * Generate a random initialization vector
 * @returns {Uint8Array} 12-byte IV
 */
export function generateIV() {
    if (!isCryptoSupported()) {
        throw new Error('Web Crypto API not supported');
    }
    return crypto.getRandomValues(new Uint8Array(12));
}

/**
 * Validate that a value is a valid IV
 * @param {*} iv - Value to check
 * @returns {boolean}
 */
export function isValidIV(iv) {
    return iv instanceof Uint8Array && iv.length === 12;
}

/**
 * Get crypto capabilities info for debugging
 * @returns {object}
 */
export function getCryptoInfo() {
    return {
        supported: isCryptoSupported(),
        algorithm: ENCRYPTION_ALGORITHM,
        keyDerivation: KEY_DERIVATION_ALGORITHM,
        secretBytes: SECRET_BYTES
    };
}
