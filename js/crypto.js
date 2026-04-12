/**
 * Encryption/Decryption utilities with error handling
 */

const ENCRYPTION_ALGORITHM = 'AES-GCM';
const KEY_DERIVATION_ALGORITHM = 'PBKDF2';
const SALT = 'DropTransferSalt2024';
const ITERATIONS = 100000;

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
 * Derive encryption key from peer IDs
 * @param {string} peerId1 - First peer ID
 * @param {string} peerId2 - Second peer ID
 * @returns {Promise<CryptoKey>} Derived key
 * @throws {Error} If crypto is not supported or derivation fails
 */
export async function deriveKey(peerId1, peerId2) {
    if (!isCryptoSupported()) {
        throw new Error('Web Crypto API not supported in this browser');
    }

    if (!peerId1 || !peerId2) {
        throw new Error('Both peer IDs are required for key derivation');
    }

    try {
        const sortedIds = [peerId1, peerId2].sort();
        const encoder = new TextEncoder();
        const data = encoder.encode(sortedIds.join(''));
        const salt = encoder.encode(SALT);

        const keyMaterial = await crypto.subtle.importKey(
            'raw',
            data,
            { name: KEY_DERIVATION_ALGORITHM },
            false,
            ['deriveKey']
        );

        return await crypto.subtle.deriveKey(
            {
                name: KEY_DERIVATION_ALGORITHM,
                salt: salt,
                iterations: ITERATIONS,
                hash: 'SHA-256'
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
        iterations: ITERATIONS
    };
}
