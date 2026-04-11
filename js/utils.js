/**
 * Format bytes to human-readable string
 * @param {number} bytes - Size in bytes
 * @returns {string} Formatted size (e.g., "1.5 MB")
 */
export function formatSize(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Escape HTML to prevent XSS
 * @param {string} text - Raw text
 * @returns {string} Escaped HTML
 */
export function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * Debounce function calls
 * @param {Function} fn - Function to debounce
 * @param {number} ms - Milliseconds to wait
 * @returns {Function} Debounced function
 */
export function debounce(fn, ms = 300) {
    let timeout;
    return (...args) => {
        clearTimeout(timeout);
        timeout = setTimeout(() => fn(...args), ms);
    };
}

/**
 * Throttle function calls
 * @param {Function} fn - Function to throttle
 * @param {number} ms - Milliseconds between calls
 * @returns {Function} Throttled function
 */
export function throttle(fn, ms = 100) {
    let lastTime = 0;
    return (...args) => {
        const now = Date.now();
        if (now - lastTime >= ms) {
            lastTime = now;
            fn(...args);
        }
    };
}

/**
 * Generate a random ID
 * @param {number} length - ID length
 * @returns {string} Random alphanumeric ID
 */
export function generateId(length = 8) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    return Array.from({ length }, () =>
        chars.charAt(Math.floor(Math.random() * chars.length))
    ).join('');
}

/**
 * Validate a PeerJS code format
 * @param {string} code - Code to validate
 * @returns {boolean} Is valid
 */
export function isValidCode(code) {
    return typeof code === 'string' &&
           code.length >= 6 &&
           code.length <= 20 &&
           /^[a-zA-Z0-9_-]+$/.test(code);
}

/**
 * Format time duration
 * @param {number} seconds - Duration in seconds
 * @returns {string} Formatted duration (e.g., "2m 30s")
 */
export function formatDuration(seconds) {
    if (seconds < 60) return Math.round(seconds) + 's';
    if (seconds < 3600) {
        const m = Math.floor(seconds / 60);
        const s = Math.round(seconds % 60);
        return `${m}m ${s}s`;
    }
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return `${h}h ${m}m`;
}

/**
 * Calculate transfer speed
 * @param {number} bytes - Bytes transferred
 * @param {number} msElapsed - Milliseconds elapsed
 * @returns {string} Formatted speed
 */
export function formatSpeed(bytes, msElapsed) {
    if (msElapsed === 0) return '0 B/s';
    const bytesPerSecond = (bytes / msElapsed) * 1000;
    return formatSize(bytesPerSecond) + '/s';
}

/**
 * Deep clone an object (for state snapshots)
 * @param {*} obj - Object to clone
 * @returns {*} Cloned object
 */
export function deepClone(obj) {
    if (obj === null || typeof obj !== 'object') return obj;
    if (obj instanceof Date) return new Date(obj);
    if (Array.isArray(obj)) return obj.map(deepClone);
    const cloned = {};
    for (const key in obj) {
        if (obj.hasOwnProperty(key)) {
            cloned[key] = deepClone(obj[key]);
        }
    }
    return cloned;
}
