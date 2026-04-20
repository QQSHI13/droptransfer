# DropTransfer Stability & Usability Improvements

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make DropTransfer more stable (prevent crashes, handle edge cases, recover from failures) and more usable (better feedback, controls, accessibility, mobile support).

**Architecture:** Refactor monolithic HTML into modular components with clear separation of concerns: state management, UI components, transfer logic, and utilities. Add comprehensive error boundaries and user feedback.

**Tech Stack:** Vanilla JavaScript (ES2020), WebRTC (PeerJS), WebTorrent, Service Workers, CSS custom properties

---

## File Structure

| File | Responsibility |
|------|---------------|
| `index.html` | Main HTML structure, minimal inline JS for initialization |
| `js/utils.js` | Utility functions (formatSize, escapeHtml, debounce, etc.) |
| `js/state.js` | Centralized state management with event emission |
| `js/crypto.js` | Encryption/decryption utilities with error handling |
| `js/transfers/peerjs.js` | WebRTC transfer logic with connection recovery |
| `js/transfers/webtorrent.js` | WebTorrent fallback implementation |
| `js/ui/components.js` | Reusable UI components (FileList, ProgressBar, Status) |
| `js/ui/dragdrop.js` | Drag-and-drop handling with visual feedback |
| `js/app.js` | Main application orchestration |
| `css/app.css` | Modular CSS with design tokens |

---

## Current Issues Identified

### Stability Issues
1. **Memory leaks**: Object URLs not cleaned up in error paths
2. **Buffer overflow**: Data channel buffer can overflow causing stalls
3. **No recovery**: No auto-retry for failed chunks or connections
4. **Race conditions**: Multiple overlapping connection attempts
5. **No size limits**: Can crash browser with very large files
6. **SW edge cases**: Hard reload detection unreliable

### Usability Issues
1. **No cancellation**: Can't abort in-progress transfers
2. **Poor mobile UX**: Touch targets too small, no viewport fixes
3. **No keyboard support**: Tab navigation broken
4. **Missing help**: First-time users don't know how to use
5. **Weak feedback**: No copy confirmation, stale connection states
6. **No validation**: Invalid codes accepted silently

---

## Task 1: Foundation - Utilities and State Management

**Files:**
- Create: `js/utils.js`
- Create: `js/state.js`

### Step 1.1: Create utility functions

- [ ] **Write the code**

Create `js/utils.js`:

```javascript
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
```

### Step 1.2: Create centralized state management

- [ ] **Write the code**

Create `js/state.js`:

```javascript
import { deepClone } from './utils.js';

/**
 * Centralized state management with event emission
 */
class StateManager {
    constructor() {
        this._state = {
            // Transfer mode
            sendMode: 'direct', // 'direct' | 'torrent'
            recvMode: 'direct',
            
            // File selection
            selectedFiles: [],
            isFolderTransfer: false,
            totalSize: 0,
            
            // Connection state
            peerId: null,
            connectionState: 'disconnected', // 'disconnected' | 'connecting' | 'connected' | 'error'
            transferState: 'idle', // 'idle' | 'preparing' | 'sending' | 'receiving' | 'completed' | 'error'
            errorMessage: null,
            
            // Progress
            progress: {
                bytesTransferred: 0,
                totalBytes: 0,
                percent: 0,
                speed: 0,
                eta: null
            },
            
            // Transfer stats
            transferStats: {
                startTime: null,
                endTime: null,
                retries: 0,
                chunksAcked: 0,
                chunksPending: 0
            }
        };
        
        this._listeners = new Map();
        this._transaction = false;
        this._pendingChanges = [];
    }
    
    /**
     * Get current state (immutable copy)
     */
    get() {
        return deepClone(this._state);
    }
    
    /**
     * Get a specific state path
     * @param {string} path - Dot-notation path (e.g., 'progress.percent')
     */
    getPath(path) {
        const keys = path.split('.');
        let value = this._state;
        for (const key of keys) {
            if (value === null || value === undefined) return undefined;
            value = value[key];
        }
        return deepClone(value);
    }
    
    /**
     * Update state (partial merge)
     * @param {object} updates - Partial state to merge
     */
    set(updates) {
        const oldState = deepClone(this._state);
        this._state = { ...this._state, ...updates };
        
        if (!this._transaction) {
            this._emitChange(oldState, this._state);
        }
        
        return this._state;
    }
    
    /**
     * Set a nested path value
     * @param {string} path - Dot-notation path
     * @param {*} value - Value to set
     */
    setPath(path, value) {
        const keys = path.split('.');
        const updates = {};
        let target = updates;
        
        for (let i = 0; i < keys.length - 1; i++) {
            target[keys[i]] = {};
            target = target[keys[i]];
        }
        target[keys[keys.length - 1]] = value;
        
        // Deep merge with current state
        const current = this.get();
        const merged = this._deepMerge(current, updates);
        this.set(merged);
    }
    
    /**
     * Subscribe to state changes
     * @param {string} event - Event name or 'change' for all changes
     * @param {Function} callback - Handler function
     * @returns {Function} Unsubscribe function
     */
    on(event, callback) {
        if (!this._listeners.has(event)) {
            this._listeners.set(event, new Set());
        }
        this._listeners.get(event).add(callback);
        
        return () => this._listeners.get(event)?.delete(callback);
    }
    
    /**
     * Subscribe to changes on a specific path
     * @param {string} path - State path to watch
     * @param {Function} callback - Handler(newValue, oldValue)
     */
    watch(path, callback) {
        let lastValue = this.getPath(path);
        
        return this.on('change', (newState, oldState) => {
            const keys = path.split('.');
            let newValue = newState;
            let oldValue = oldState;
            
            for (const key of keys) {
                newValue = newValue?.[key];
                oldValue = oldValue?.[key];
            }
            
            if (JSON.stringify(newValue) !== JSON.stringify(lastValue)) {
                lastValue = deepClone(newValue);
                callback(newValue, oldValue);
            }
        });
    }
    
    /**
     * Start a transaction (batch multiple updates)
     */
    beginTransaction() {
        this._transaction = true;
        this._pendingChanges = [];
        return this;
    }
    
    /**
     * Commit transaction and emit changes
     */
    commit() {
        this._transaction = false;
        const oldState = deepClone(this._state);
        this._emitChange(oldState, this._state);
        return this;
    }
    
    /**
     * Reset state to initial values
     */
    reset() {
        const initial = {
            selectedFiles: [],
            isFolderTransfer: false,
            totalSize: 0,
            peerId: null,
            connectionState: 'disconnected',
            transferState: 'idle',
            errorMessage: null,
            progress: {
                bytesTransferred: 0,
                totalBytes: 0,
                percent: 0,
                speed: 0,
                eta: null
            },
            transferStats: {
                startTime: null,
                endTime: null,
                retries: 0,
                chunksAcked: 0,
                chunksPending: 0
            }
        };
        this.set(initial);
    }
    
    _emitChange(oldState, newState) {
        // Emit general change event
        this._listeners.get('change')?.forEach(cb => {
            try { cb(newState, oldState); } catch (e) { console.error(e); }
        });
        
        // Emit specific events
        for (const [key, value] of Object.entries(newState)) {
            if (JSON.stringify(value) !== JSON.stringify(oldState[key])) {
                this._listeners.get(key)?.forEach(cb => {
                    try { cb(value, oldState[key]); } catch (e) { console.error(e); }
                });
            }
        }
    }
    
    _deepMerge(target, source) {
        const result = { ...target };
        for (const key in source) {
            if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
                result[key] = this._deepMerge(target[key] || {}, source[key]);
            } else {
                result[key] = source[key];
            }
        }
        return result;
    }
}

// Singleton instance
export const state = new StateManager();
export default state;
```

- [ ] **Step 1.3: Commit**

```bash
git add js/utils.js js/state.js
git commit -m "feat: add utilities and centralized state management"
```

---

## Task 2: Crypto Module with Error Handling

**Files:**
- Create: `js/crypto.js`

### Step 2.1: Create crypto module with comprehensive error handling

- [ ] **Write the code**

Create `js/crypto.js`:

```javascript
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
```

- [ ] **Step 2.2: Commit**

```bash
git add js/crypto.js
git commit -m "feat: add crypto module with error handling"
```

---

## Task 3: Refactored PeerJS Transfer Module

**Files:**
- Create: `js/transfers/peerjs.js`

### Step 3.1: Create improved PeerJS transfer module

- [ ] **Write the code**

Create `js/transfers/peerjs.js`:

```javascript
import state from '../state.js';
import { deriveKey, encryptChunk, decryptChunk, generateIV } from '../crypto.js';
import { formatSpeed } from '../utils.js';

// Configuration
const CHUNK_SIZE = 262144; // 256KB
const MAX_BUFFER = 8388608; // 8MB buffer threshold
const MAX_IN_FLIGHT = 32; // Max chunks without acknowledgment
const ACK_TIMEOUT = 30000; // 30 seconds
const MAX_RETRIES = 3;
const CONNECTION_TIMEOUT = 20000;

// ICE configuration for NAT traversal
const ICE_CONFIG = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' }, 
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun3.l.google.com:19302' },
        { urls: 'stun:stun4.l.google.com:19302' },
        { urls: 'stun:stun01.sipphone.com' },
        { urls: 'stun:stun.ekiga.net' },
        { urls: 'stun:stun.ideasip.com' },
        { urls: 'stun:stun.iptel.org' },
        { urls: 'stun:stun.schlund.de' },
        { urls: 'stun:stunserver.org' },
        { urls: 'stun:stun.voipbuster.com' }
    ],
    iceCandidatePoolSize: 10,
    iceTransportPolicy: 'all'
};

/**
 * PeerJS Transfer Manager
 * Handles sender and receiver WebRTC connections with reliability
 */
export class PeerJSTransfer {
    constructor() {
        this.peer = null;
        this.conn = null;
        this.encryptionKey = null;
        this.isSender = false;
        
        // Transfer state
        this.pendingAcks = new Map();
        this.dataQueue = [];
        this.isProcessingData = false;
        this.chunkCache = new Map();
        this.expectedChunkIndex = 0;
        this.receivedChunks = [];
        this.receivedSize = 0;
        this.currentFileIndex = 0;
        this.metadataReceived = false;
        this.fileInfo = null;
        this.receivedFiles = [];
        
        // Timing
        this.transferStartTime = null;
        this.lastProgressUpdate = 0;
        
        // Cleanup tracking
        this.objectURLs = [];
        this.connectionTimeout = null;
        this.abortController = null;
    }
    
    /**
     * Initialize as sender
     * @param {Function} onReady - Called when peer ID is ready
     * @param {Function} onError - Called on errors
     */
    async initSender(onReady, onError) {
        this.isSender = true;
        this.abortController = new AbortController();
        
        try {
            state.set({ connectionState: 'connecting' });
            
            this.peer = new Peer({
                config: ICE_CONFIG,
                debug: 1
            });
            
            this.peer.on('open', (id) => {
                console.log('[PeerJS] Sender ready, ID:', id);
                state.set({ peerId: id, connectionState: 'waiting' });
                onReady?.(id);
            });
            
            this.peer.on('connection', (connection) => {
                this._handleIncomingConnection(connection, onError);
            });
            
            this.peer.on('error', (err) => {
                console.error('[PeerJS] Peer error:', err);
                state.set({ connectionState: 'error', errorMessage: err.message });
                onError?.(err);
            });
            
            this.peer.on('disconnected', () => {
                console.log('[PeerJS] Disconnected from signaling server');
                state.set({ connectionState: 'connecting' });
                this.peer.reconnect();
            });
            
        } catch (err) {
            console.error('[PeerJS] Failed to initialize sender:', err);
            state.set({ connectionState: 'error', errorMessage: err.message });
            onError?.(err);
        }
    }
    
    /**
     * Initialize as receiver
     * @param {string} code - Sender's peer ID
     * @param {Function} onProgress - Progress callback
     * @param {Function} onComplete - Completion callback
     * @param {Function} onError - Error callback
     */
    async initReceiver(code, onProgress, onComplete, onError) {
        this.isSender = false;
        this.abortController = new AbortController();
        
        if (!code) {
            onError?.(new Error('Please enter a transfer code'));
            return;
        }
        
        try {
            state.set({ connectionState: 'connecting' });
            
            this.peer = new Peer({
                config: ICE_CONFIG,
                debug: 1
            });
            
            this.peer.on('open', (myId) => {
                console.log('[PeerJS] Receiver ready, connecting to:', code);
                
                this.conn = this.peer.connect(code, {
                    reliable: true,
                    serialization: 'binary',
                    ordered: true
                });
                
                this._setupReceiverConnection(code, onProgress, onComplete, onError);
            });
            
            this.peer.on('error', (err) => {
                console.error('[PeerJS] Peer error:', err);
                let msg = 'Connection failed';
                if (err.type === 'peer-unavailable') {
                    msg = 'Sender not found. Check the code and try again.';
                } else if (err.type === 'network') {
                    msg = 'Network error. Check your connection.';
                }
                state.set({ connectionState: 'error', errorMessage: msg });
                onError?.(new Error(msg));
            });
            
            // Connection timeout
            this.connectionTimeout = setTimeout(() => {
                if (state.get().connectionState === 'connecting') {
                    const msg = 'Connection timeout. The sender may be offline.';
                    state.set({ connectionState: 'error', errorMessage: msg });
                    onError?.(new Error(msg));
                    this.cleanup();
                }
            }, CONNECTION_TIMEOUT);
            
        } catch (err) {
            console.error('[PeerJS] Failed to initialize receiver:', err);
            state.set({ connectionState: 'error', errorMessage: err.message });
            onError?.(err);
        }
    }
    
    /**
     * Send files to connected peer
     * @param {Array} files - Array of {file, path, relativePath}
     * @param {Function} onProgress - Progress callback(bytesSent, totalBytes, speed)
     * @param {Function} onComplete - Completion callback
     * @param {Function} onError - Error callback
     */
    async sendFiles(files, onProgress, onComplete, onError) {
        if (!this.conn || !this.conn.open) {
            onError?.(new Error('Not connected to receiver'));
            return;
        }
        
        if (!files || files.length === 0) {
            onError?.(new Error('No files selected'));
            return;
        }
        
        this.transferStartTime = performance.now();
        state.set({ transferState: 'sending' });
        
        const totalBytes = files.reduce((sum, f) => sum + f.file.size, 0);
        let bytesSent = 0;
        
        try {
            // Send metadata
            const metadata = {
                type: 'metadata',
                fileCount: files.length,
                files: files.map(f => ({ name: f.file.name, path: f.path, size: f.file.size })),
                totalSize: totalBytes
            };
            this.conn.send(metadata);
            
            // Send each file
            for (let fileIndex = 0; fileIndex < files.length; fileIndex++) {
                if (this.abortController?.signal.aborted) {
                    throw new Error('Transfer cancelled');
                }
                
                const { file } = files[fileIndex];
                await this._sendFile(file, fileIndex, (chunkBytes) => {
                    bytesSent += chunkBytes;
                    const now = performance.now();
                    if (now - this.lastProgressUpdate > 100) { // Throttle updates
                        const speed = (bytesSent / (now - this.transferStartTime)) * 1000;
                        const percent = (bytesSent / totalBytes) * 100;
                        state.setPath('progress', {
                            bytesTransferred: bytesSent,
                            totalBytes,
                            percent,
                            speed,
                            eta: speed > 0 ? (totalBytes - bytesSent) / speed : null
                        });
                        onProgress?.(bytesSent, totalBytes, speed);
                        this.lastProgressUpdate = now;
                    }
                });
            }
            
            this.conn.send({ type: 'done' });
            state.set({ transferState: 'completed' });
            onComplete?.();
            
        } catch (err) {
            console.error('[PeerJS] Send failed:', err);
            state.set({ transferState: 'error', errorMessage: err.message });
            onError?.(err);
        }
    }
    
    /**
     * Cancel ongoing transfer
     */
    cancel() {
        this.abortController?.abort();
        this.cleanup();
        state.set({ transferState: 'idle' });
    }
    
    /**
     * Clean up all resources
     */
    cleanup() {
        // Clear timeouts
        if (this.connectionTimeout) {
            clearTimeout(this.connectionTimeout);
            this.connectionTimeout = null;
        }
        
        // Close connection
        if (this.conn) {
            this.conn.close();
            this.conn = null;
        }
        
        // Destroy peer
        if (this.peer) {
            this.peer.destroy();
            this.peer = null;
        }
        
        // Revoke object URLs
        this.objectURLs.forEach(url => URL.revokeObjectURL(url));
        this.objectURLs = [];
        
        // Clear state
        this.pendingAcks.clear();
        this.dataQueue = [];
        this.chunkCache.clear();
        this.receivedChunks = [];
        this.receivedFiles = [];
        this.metadataReceived = false;
        this.encryptionKey = null;
        
        state.set({ connectionState: 'disconnected', transferState: 'idle' });
    }
    
    // Private methods
    
    _handleIncomingConnection(connection, onError) {
        console.log('[PeerJS] Incoming connection from:', connection.peer);
        
        this.conn = connection;
        this.conn.serialization = 'binary';
        this.conn.reliable = true;
        
        // Derive encryption key
        deriveKey(this.peer.id, connection.peer)
            .then(key => {
                this.encryptionKey = key;
                console.log('[PeerJS] Encryption established');
            })
            .catch(err => {
                console.error('[PeerJS] Key derivation failed:', err);
            });
        
        this.conn.on('data', (data) => this._handleData(data));
        
        this.conn.on('error', (err) => {
            console.error('[PeerJS] Connection error:', err);
            state.set({ connectionState: 'error', errorMessage: err.message });
            onError?.(err);
        });
        
        this.conn.on('close', () => {
            console.log('[PeerJS] Connection closed');
            state.set({ connectionState: 'disconnected' });
        });
        
        state.set({ connectionState: 'connected' });
    }
    
    _setupReceiverConnection(code, onProgress, onComplete, onError) {
        this.conn.on('open', async () => {
            console.log('[PeerJS] Connected to sender');
            clearTimeout(this.connectionTimeout);
            
            state.set({ connectionState: 'connected' });
            
            try {
                this.encryptionKey = await deriveKey(code, this.peer.id);
            } catch (err) {
                console.error('[PeerJS] Key derivation failed:', err);
            }
            
            this.conn.send('ready');
        });
        
        this.conn.on('data', (data) => {
            this._handleReceiverData(data, onProgress, onComplete, onError);
        });
        
        this.conn.on('error', (err) => {
            console.error('[PeerJS] Connection error:', err);
            clearTimeout(this.connectionTimeout);
            state.set({ connectionState: 'error', errorMessage: err.message });
            onError?.(err);
        });
        
        this.conn.on('close', () => {
            clearTimeout(this.connectionTimeout);
        });
    }
    
    async _sendFile(file, fileIndex, onChunkSent) {
        const buffer = await file.arrayBuffer();
        const totalChunks = Math.ceil(buffer.byteLength / CHUNK_SIZE);
        
        this.conn.send({
            type: 'fileStart',
            fileIndex,
            name: file.name,
            totalChunks
        });
        
        this.pendingAcks.clear();
        let nextChunkIdx = 0;
        
        while (nextChunkIdx < totalChunks) {
            if (this.abortController?.signal.aborted) {
                throw new Error('Transfer cancelled');
            }
            
            // Backpressure control
            while (this.conn && this.conn.open && (
                (this.conn.dataChannel?.bufferedAmount > MAX_BUFFER) ||
                this.pendingAcks.size >= MAX_IN_FLIGHT
            )) {
                await new Promise(r => setTimeout(r, 10));
            }
            
            if (!this.conn?.open) {
                throw new Error('Connection closed during send');
            }
            
            const start = nextChunkIdx * CHUNK_SIZE;
            const end = Math.min(start + CHUNK_SIZE, buffer.byteLength);
            let chunk = buffer.slice(start, end);
            let iv = null;
            
            if (this.encryptionKey) {
                iv = generateIV();
                chunk = await encryptChunk(this.encryptionKey, chunk, iv);
            }
            
            const chunkKey = `${fileIndex}-${nextChunkIdx}`;
            this.pendingAcks.set(chunkKey, { index: nextChunkIdx, fileIndex, retries: 0 });
            
            this.conn.send({
                type: 'chunk',
                data: new Uint8Array(chunk),
                index: nextChunkIdx,
                total: totalChunks,
                iv: iv ? Array.from(iv) : null,
                fileIndex
            });
            
            onChunkSent(end - start);
            nextChunkIdx++;
        }
        
        // Wait for acknowledgments
        await this._waitForAcks(fileIndex, totalChunks, buffer, file);
        
        this.conn.send({ type: 'fileDone', fileIndex });
    }
    
    async _waitForAcks(fileIndex, totalChunks, buffer, file) {
        let retryCount = 0;
        
        while (this.pendingAcks.size > 0 && retryCount < MAX_RETRIES) {
            const waitStart = Date.now();
            
            while (this.pendingAcks.size > 0 && (Date.now() - waitStart) < ACK_TIMEOUT) {
                await new Promise(r => setTimeout(r, 100));
            }
            
            if (this.pendingAcks.size > 0) {
                retryCount++;
                if (retryCount < MAX_RETRIES) {
                    console.warn(`[PeerJS] Retry ${retryCount}: ${this.pendingAcks.size} chunks unacknowledged`);
                    await this._resendUnackedChunks(fileIndex, file);
                }
            }
        }
        
        if (this.pendingAcks.size > 0) {
            throw new Error(`${this.pendingAcks.size} chunks not acknowledged after ${MAX_RETRIES} retries`);
        }
    }
    
    async _resendUnackedChunks(fileIndex, file) {
        for (const [chunkKey, chunkInfo] of this.pendingAcks) {
            if (!this.conn?.open) return;
            
            const { index: chunkIdx } = chunkInfo;
            const start = chunkIdx * CHUNK_SIZE;
            const end = Math.min(start + CHUNK_SIZE, file.size);
            const chunk = file.slice(start, end);
            
            let dataToSend = await chunk.arrayBuffer();
            let iv = null;
            
            if (this.encryptionKey) {
                iv = generateIV();
                dataToSend = await encryptChunk(this.encryptionKey, dataToSend, iv);
            }
            
            this.conn.send({
                type: 'chunk',
                data: new Uint8Array(dataToSend),
                index: chunkIdx,
                total: Math.ceil(file.size / CHUNK_SIZE),
                iv: iv ? Array.from(iv) : null,
                fileIndex
            });
        }
    }
    
    _handleData(data) {
        if (data === 'ready') {
            console.log('[PeerJS] Receiver ready');
            state.set({ transferState: 'sending' });
        } else if (data === 'received') {
            console.log('[PeerJS] Transfer acknowledged by receiver');
            state.set({ transferState: 'completed' });
        } else if (data?.type === 'ack') {
            const ackKey = `${data.fileIndex}-${data.chunkIndex}`;
            this.pendingAcks.delete(ackKey);
        }
    }
    
    _handleReceiverData(data, onProgress, onComplete, onError) {
        this.dataQueue.push(data);
        this._processDataQueue(onProgress, onComplete, onError);
    }
    
    async _processDataQueue(onProgress, onComplete, onError) {
        if (this.isProcessingData) return;
        this.isProcessingData = true;
        
        try {
            while (this.dataQueue.length > 0) {
                const data = this.dataQueue.shift();
                await this._processDataItem(data, onProgress, onComplete, onError);
            }
        } catch (err) {
            console.error('[PeerJS] Error processing data:', err);
            onError?.(err);
        } finally {
            this.isProcessingData = false;
        }
    }
    
    async _processDataItem(data, onProgress, onComplete, onError) {
        switch (data.type) {
            case 'metadata':
                if (this.metadataReceived) return;
                this.metadataReceived = true;
                this.fileInfo = data;
                this.transferStartTime = performance.now();
                state.set({ 
                    transferState: 'receiving',
                    'progress.totalBytes': data.totalSize 
                });
                break;
                
            case 'fileStart':
                if (this.receivedChunks.length > 0) {
                    this._saveCurrentFile();
                }
                this.currentFileIndex = data.fileIndex;
                this.receivedChunks = [];
                this.receivedSize = 0;
                this.expectedChunkIndex = 0;
                this.chunkCache.clear();
                break;
                
            case 'chunk':
                await this._handleChunk(data, onProgress);
                break;
                
            case 'fileDone':
                this._saveCurrentFile();
                break;
                
            case 'done':
                if (this.receivedChunks.length > 0) {
                    this._saveCurrentFile();
                }
                this.conn?.send('received');
                state.set({ transferState: 'completed' });
                onComplete?.(this.receivedFiles);
                break;
        }
    }
    
    async _handleChunk(data, onProgress) {
        // Validate chunk
        if (!data.data || !(data.data instanceof ArrayBuffer || ArrayBuffer.isView(data.data))) {
            console.error('[PeerJS] Invalid chunk data');
            return;
        }
        
        let chunkData = data.data instanceof ArrayBuffer ? data.data : data.data.buffer;
        
        // Decrypt if needed
        if (this.encryptionKey && data.iv) {
            try {
                const iv = new Uint8Array(data.iv);
                chunkData = await decryptChunk(this.encryptionKey, chunkData, iv);
            } catch (err) {
                console.error('[PeerJS] Decryption failed:', err);
                return;
            }
        }
        
        // Handle out-of-order chunks
        if (data.index === this.expectedChunkIndex) {
            this.receivedChunks.push(chunkData);
            this.receivedSize += chunkData.byteLength;
            this.expectedChunkIndex++;
            
            // Process cached chunks
            while (this.chunkCache.has(this.expectedChunkIndex)) {
                const cached = this.chunkCache.get(this.expectedChunkIndex);
                this.receivedChunks.push(cached);
                this.receivedSize += cached.byteLength;
                this.chunkCache.delete(this.expectedChunkIndex);
                this.expectedChunkIndex++;
            }
        } else {
            this.chunkCache.set(data.index, chunkData);
        }
        
        // Send acknowledgment
        this.conn?.send({ type: 'ack', chunkIndex: data.index, fileIndex: data.fileIndex });
        
        // Update progress
        const percent = (this.receivedSize / this.fileInfo.totalSize) * 100;
        const elapsed = (performance.now() - this.transferStartTime) / 1000;
        const speed = elapsed > 0 ? this.receivedSize / elapsed : 0;
        
        state.setPath('progress', {
            bytesTransferred: this.receivedSize,
            percent,
            speed
        });
        onProgress?.(this.receivedSize, this.fileInfo.totalSize, speed);
    }
    
    _saveCurrentFile() {
        if (this.receivedChunks.length === 0) return;
        
        const blob = new Blob(this.receivedChunks);
        const fileInfo = this.fileInfo.files[this.currentFileIndex];
        
        this.receivedFiles.push({
            blob,
            name: fileInfo.name,
            path: fileInfo.path,
            size: blob.size
        });
        
        this.receivedChunks = [];
    }
}

export default PeerJSTransfer;
```

- [ ] **Step 3.2: Commit**

```bash
git add js/transfers/peerjs.js
git commit -m "feat: add improved PeerJS transfer module with reliability"
```

---

## Task 4: Drag and Drop Module with Better UX

**Files:**
- Create: `js/ui/dragdrop.js`
- Create: `js/ui/components.js`

### Step 4.1: Create drag-and-drop module with visual feedback

- [ ] **Write the code**

Create `js/ui/dragdrop.js`:

```javascript
import state from '../state.js';
import { formatSize } from '../utils.js';

/**
 * Drag and Drop handler with visual feedback
 */
export class DragDropHandler {
    constructor(dropZoneId, fileInputId, folderInputId, options = {}) {
        this.dropZone = document.getElementById(dropZoneId);
        this.fileInput = document.getElementById(fileInputId);
        this.folderInput = document.getElementById(folderInputId);
        this.options = {
            onFilesSelected: () => {},
            onError: () => {},
            maxFileSize: 2 * 1024 * 1024 * 1024, // 2GB default
            acceptedTypes: null, // null = all types
            ...options
        };
        
        this.dragCounter = 0; // Track nested drag events
        this.init();
    }
    
    init() {
        if (!this.dropZone || !this.fileInput) {
            console.error('[DragDrop] Required elements not found');
            return;
        }
        
        // Click to select files
        this.dropZone.addEventListener('click', (e) => {
            // Don't trigger if right-clicking
            if (e.button !== 0) return;
            this.fileInput.click();
        });
        
        // Right-click for folder selection
        this.dropZone.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            if (this.folderInput) {
                this.folderInput.click();
            }
        });
        
        // File input change
        this.fileInput.addEventListener('change', (e) => {
            this._handleFileInput(e.target.files);
            e.target.value = ''; // Reset for re-selection
        });
        
        // Folder input change
        if (this.folderInput) {
            this.folderInput.addEventListener('change', (e) => {
                this._handleFolderInput(e.target.files);
                e.target.value = '';
            });
        }
        
        // Drag events
        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
            this.dropZone.addEventListener(eventName, (e) => {
                e.preventDefault();
                e.stopPropagation();
            }, false);
        });
        
        this.dropZone.addEventListener('dragenter', (e) => {
            this.dragCounter++;
            this._setDragOver(true);
        });
        
        this.dropZone.addEventListener('dragleave', (e) => {
            this.dragCounter--;
            if (this.dragCounter === 0) {
                this._setDragOver(false);
            }
        });
        
        this.dropZone.addEventListener('drop', (e) => {
            this.dragCounter = 0;
            this._setDragOver(false);
            this._handleDrop(e);
        });
        
        // Keyboard accessibility
        this.dropZone.setAttribute('tabindex', '0');
        this.dropZone.setAttribute('role', 'button');
        this.dropZone.setAttribute('aria-label', 'Select files to send. Press Enter to browse, or right-click for folder selection.');
        
        this.dropZone.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                this.fileInput.click();
            }
        });
    }
    
    _setDragOver(isOver) {
        if (isOver) {
            this.dropZone.classList.add('dragover');
            this.dropZone.setAttribute('aria-dropeffect', 'copy');
        } else {
            this.dropZone.classList.remove('dragover');
            this.dropZone.removeAttribute('aria-dropeffect');
        }
    }
    
    async _handleDrop(e) {
        const items = e.dataTransfer?.items;
        if (!items) return;
        
        const files = [];
        let isFolder = false;
        
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            if (item.kind === 'file') {
                const entry = item.webkitGetAsEntry();
                if (entry) {
                    if (entry.isDirectory) isFolder = true;
                    await this._traverseEntry(entry, '', files);
                }
            }
        }
        
        if (files.length > 0) {
            this._processFiles(files, isFolder);
        }
    }
    
    _handleFileInput(files) {
        if (!files || files.length === 0) return;
        
        const fileList = Array.from(files).map(file => ({
            file,
            path: file.name,
            relativePath: file.webkitRelativePath || file.name
        }));
        
        this._processFiles(fileList, false);
    }
    
    _handleFolderInput(files) {
        if (!files || files.length === 0) return;
        
        const fileList = Array.from(files).map(file => ({
            file,
            path: file.webkitRelativePath || file.name,
            relativePath: file.webkitRelativePath || file.name
        }));
        
        this._processFiles(fileList, true);
    }
    
    async _traverseEntry(entry, path, files) {
        return new Promise((resolve, reject) => {
            if (entry.isFile) {
                entry.file(
                    file => {
                        files.push({
                            file,
                            path: path + entry.name,
                            relativePath: path + entry.name
                        });
                        resolve();
                    },
                    err => {
                        console.error('[DragDrop] Error reading file:', err);
                        reject(err);
                    }
                );
            } else if (entry.isDirectory) {
                const dirReader = entry.createReader();
                const allEntries = [];
                
                const readEntries = () => {
                    dirReader.readEntries(async (entries) => {
                        if (entries.length === 0) {
                            // Process all accumulated entries
                            try {
                                for (const subEntry of allEntries) {
                                    await this._traverseEntry(subEntry, path + entry.name + '/', files);
                                }
                                resolve();
                            } catch (err) {
                                reject(err);
                            }
                            return;
                        }
                        allEntries.push(...entries);
                        readEntries(); // Continue reading
                    }, reject);
                };
                
                readEntries();
            }
        });
    }
    
    _processFiles(files, isFolder) {
        // Validate files
        const errors = [];
        const validFiles = [];
        let totalSize = 0;
        
        for (const f of files) {
            // Check file size
            if (f.file.size > this.options.maxFileSize) {
                errors.push(`${f.file.name} exceeds maximum size of ${formatSize(this.options.maxFileSize)}`);
                continue;
            }
            
            // Check file type if specified
            if (this.options.acceptedTypes && !this.options.acceptedTypes.includes(f.file.type)) {
                errors.push(`${f.file.name} is not an accepted file type`);
                continue;
            }
            
            validFiles.push(f);
            totalSize += f.file.size;
        }
        
        // Warn about very large transfers
        const WARNING_SIZE = 500 * 1024 * 1024; // 500MB
        if (totalSize > WARNING_SIZE) {
            console.warn(`[DragDrop] Large transfer: ${formatSize(totalSize)}`);
        }
        
        // Report errors
        if (errors.length > 0) {
            this.options.onError(errors);
        }
        
        // Update state
        if (validFiles.length > 0) {
            state.set({
                selectedFiles: validFiles,
                isFolderTransfer: isFolder,
                totalSize
            });
            this.options.onFilesSelected(validFiles, isFolder, totalSize);
        }
    }
    
    /**
     * Update drop zone visual state
     * @param {string} state - 'idle', 'dragging', 'processing', 'ready'
     * @param {string} message - Optional message to display
     */
    setVisualState(visualState, message) {
        const states = ['idle', 'dragging', 'processing', 'ready'];
        states.forEach(s => this.dropZone.classList.remove(`state-${s}`));
        this.dropZone.classList.add(`state-${visualState}`);
        
        if (message) {
            const textEl = this.dropZone.querySelector('p');
            if (textEl) {
                textEl.dataset.originalText = textEl.dataset.originalText || textEl.innerHTML;
                textEl.innerHTML = message;
            }
        }
    }
    
    /**
     * Reset to initial state
     */
    reset() {
        state.set({ selectedFiles: [], isFolderTransfer: false, totalSize: 0 });
        this.setVisualState('idle');
        const textEl = this.dropZone.querySelector('p');
        if (textEl?.dataset.originalText) {
            textEl.innerHTML = textEl.dataset.originalText;
        }
    }
}

export default DragDropHandler;
```

### Step 4.2: Create reusable UI components

- [ ] **Write the code**

Create `js/ui/components.js`:

```javascript
import { formatSize, formatDuration, escapeHtml } from '../utils.js';

/**
 * File List Component
 */
export class FileListComponent {
    constructor(containerId, options = {}) {
        this.container = document.getElementById(containerId);
        this.options = {
            maxPreview: 5,
            onRemove: null,
            ...options
        };
    }
    
    render(files, isFolder) {
        if (!this.container) return;
        
        this.container.innerHTML = '';
        
        if (!files || files.length === 0) {
            this.container.style.display = 'none';
            return;
        }
        
        this.container.style.display = 'block';
        const totalSize = files.reduce((sum, f) => sum + f.file.size, 0);
        
        // Folder/Multi-file summary
        if (isFolder || files.length > 1) {
            const summaryCard = document.createElement('div');
            summaryCard.className = 'file-card folder show';
            summaryCard.innerHTML = `
                <div class="file-name">📁 ${isFolder ? 'Folder' : 'Multiple Files'}</div>
                <div class="file-count">${files.length} files • ${formatSize(totalSize)}</div>
            `;
            this.container.appendChild(summaryCard);
            
            // Preview files
            files.slice(0, this.options.maxPreview).forEach((f, idx) => {
                this.container.appendChild(this._createFileCard(f, idx));
            });
            
            // "And X more" message
            if (files.length > this.options.maxPreview) {
                const moreCard = document.createElement('div');
                moreCard.className = 'file-card show';
                moreCard.style.textAlign = 'center';
                moreCard.style.color = 'var(--text-secondary)';
                moreCard.textContent = `... and ${files.length - this.options.maxPreview} more files`;
                this.container.appendChild(moreCard);
            }
        } else {
            // Single file
            this.container.appendChild(this._createFileCard(files[0], 0));
        }
    }
    
    _createFileCard(fileEntry, index) {
        const card = document.createElement('div');
        card.className = 'file-card show';
        
        const icon = this._getFileIcon(fileEntry.file.type);
        
        card.innerHTML = `
            <div class="file-name">${icon} ${escapeHtml(fileEntry.file.name)}</div>
            ${fileEntry.path !== fileEntry.file.name ? `<div class="file-path">${escapeHtml(fileEntry.path)}</div>` : ''}
            <div class="file-size">${formatSize(fileEntry.file.size)}</div>
        `;
        
        if (this.options.onRemove) {
            const removeBtn = document.createElement('button');
            removeBtn.className = 'file-remove-btn';
            removeBtn.innerHTML = '×';
            removeBtn.setAttribute('aria-label', `Remove ${fileEntry.file.name}`);
            removeBtn.onclick = () => this.options.onRemove(index);
            card.appendChild(removeBtn);
        }
        
        return card;
    }
    
    _getFileIcon(mimeType) {
        if (mimeType.startsWith('image/')) return '🖼️';
        if (mimeType.startsWith('video/')) return '🎬';
        if (mimeType.startsWith('audio/')) return '🎵';
        if (mimeType.includes('pdf')) return '📄';
        if (mimeType.includes('zip') || mimeType.includes('compressed')) return '📦';
        if (mimeType.includes('text')) return '📝';
        if (mimeType.includes('json') || mimeType.includes('xml')) return '📋';
        return '📄';
    }
    
    clear() {
        if (this.container) {
            this.container.innerHTML = '';
            this.container.style.display = 'none';
        }
    }
}

/**
 * Progress Bar Component
 */
export class ProgressComponent {
    constructor(progressBarId, progressTextId) {
        this.progressBar = document.getElementById(progressBarId);
        this.progressFill = this.progressBar?.querySelector('.progress-fill');
        this.progressText = document.getElementById(progressTextId);
    }
    
    show() {
        this.progressBar?.classList.add('show');
    }
    
    hide() {
        this.progressBar?.classList.remove('show');
    }
    
    update(percent, text) {
        if (this.progressFill) {
            this.progressFill.style.width = `${Math.min(100, Math.max(0, percent))}%`;
        }
        if (this.progressText) {
            this.progressText.textContent = text || '';
        }
    }
    
    updateFromState(progressState) {
        const { percent, bytesTransferred, totalBytes, speed, eta } = progressState;
        
        let text = '';
        if (speed > 0) {
            const speedStr = formatSize(speed) + '/s';
            const etaStr = eta ? ` • ${formatDuration(eta)} remaining` : '';
            text = `${Math.round(percent)}% • ${formatSize(bytesTransferred)} / ${formatSize(totalBytes)} • ${speedStr}${etaStr}`;
        } else {
            text = `${Math.round(percent)}% • ${formatSize(bytesTransferred)} / ${formatSize(totalBytes)}`;
        }
        
        this.update(percent, text);
    }
    
    reset() {
        this.update(0, '');
        this.hide();
    }
}

/**
 * Status Message Component
 */
export class StatusComponent {
    constructor(elementId) {
        this.element = document.getElementById(elementId);
    }
    
    show(message, type = 'info', duration = null) {
        if (!this.element) return;
        
        this.element.textContent = message;
        this.element.className = `status show ${type}`;
        this.element.style.display = 'block';
        
        // Accessibility: announce to screen readers
        this.element.setAttribute('role', 'status');
        this.element.setAttribute('aria-live', type === 'error' ? 'assertive' : 'polite');
        
        if (duration) {
            setTimeout(() => this.hide(), duration);
        }
    }
    
    hide() {
        if (this.element) {
            this.element.className = 'status';
            this.element.style.display = 'none';
        }
    }
    
    success(message, duration = 3000) {
        this.show(message, 'success', duration);
    }
    
    error(message, duration = null) {
        this.show(message, 'error', duration);
    }
    
    info(message, duration = null) {
        this.show(message, 'info', duration);
    }
    
    warning(message, duration = null) {
        this.show(message, 'warning', duration);
    }
}

/**
 * Transfer Mode Indicator Component
 */
export class TransferModeIndicator {
    constructor(elementId) {
        this.element = document.getElementById(elementId);
    }
    
    showWebRTC() {
        if (!this.element) return;
        this.element.style.display = 'flex';
        this.element.className = 'transfer-mode-indicator webrtc';
        this.element.innerHTML = '🔒 Encrypted WebRTC connection';
    }
    
    showWebTorrent() {
        if (!this.element) return;
        this.element.style.display = 'flex';
        this.element.className = 'transfer-mode-indicator webtorrent';
        this.element.innerHTML = '🌐 WebTorrent (fallback)';
    }
    
    showConnecting() {
        if (!this.element) return;
        this.element.style.display = 'flex';
        this.element.className = 'transfer-mode-indicator webrtc';
        this.element.textContent = '🌐 Connecting...';
    }
    
    showError(fallbackToTorrent = false) {
        if (!this.element) return;
        this.element.style.display = 'flex';
        this.element.className = 'transfer-mode-indicator webtorrent';
        
        if (fallbackToTorrent) {
            this.element.innerHTML = '⚠️ WebRTC failed. <button class="link" onclick="window.setRecvMode(\'torrent\')">Try WebTorrent</button>';
        } else {
            this.element.textContent = '⚠️ Connection failed';
        }
    }
    
    hide() {
        if (this.element) {
            this.element.style.display = 'none';
        }
    }
}

/**
 * Copy Button with Feedback
 */
export class CopyButton {
    constructor(elementId, statusComponent) {
        this.element = document.getElementById(elementId);
        this.status = statusComponent;
        
        if (this.element) {
            this.element.addEventListener('click', () => this.copy());
            this.element.style.cursor = 'pointer';
            this.element.title = 'Click to copy';
        }
    }
    
    async copy() {
        if (!this.element) return;
        
        const text = this.element.textContent || this.element.value;
        
        try {
            await navigator.clipboard.writeText(text);
            this.status?.success('Copied to clipboard!');
            
            // Visual feedback
            const originalText = this.element.textContent;
            if (this.element.classList.contains('code-value')) {
                this.element.style.background = 'rgba(88, 166, 255, 0.2)';
                setTimeout(() => {
                    this.element.style.background = '';
                }, 500);
            }
        } catch (err) {
            console.error('[CopyButton] Failed to copy:', err);
            this.status?.error('Failed to copy. Please copy manually.');
        }
    }
}

/**
 * Download Manager Component
 */
export class DownloadManager {
    constructor(containerId, multiFileId) {
        this.container = document.getElementById(containerId);
        this.multiFileContainer = document.getElementById(multiFileId);
        this.objectURLs = [];
    }
    
    createDownload(files) {
        this.clear();
        
        if (!files || files.length === 0) return;
        
        if (files.length === 1) {
            // Single file download
            const file = files[0];
            const url = URL.createObjectURL(file.blob);
            this.objectURLs.push(url);
            
            const link = this.container?.querySelector('a');
            if (link) {
                link.href = url;
                link.download = file.name;
                link.innerHTML = `⬇️ Download ${escapeHtml(file.name)}`;
            }
            this.container?.classList.add('show');
        } else {
            // Multiple file downloads
            if (this.multiFileContainer) {
                this.multiFileContainer.innerHTML = '<div style="margin-top: 16px; font-weight: 600;">Download Files:</div>';
                
                files.forEach(file => {
                    const url = URL.createObjectURL(file.blob);
                    this.objectURLs.push(url);
                    
                    const btn = document.createElement('a');
                    btn.href = url;
                    btn.download = file.name;
                    btn.className = 'download-btn';
                    btn.style.marginTop = '8px';
                    btn.innerHTML = `⬇️ ${escapeHtml(file.name)} (${formatSize(file.size)})`;
                    this.multiFileContainer.appendChild(btn);
                });
            }
        }
    }
    
    clear() {
        // Revoke all object URLs
        this.objectURLs.forEach(url => URL.revokeObjectURL(url));
        this.objectURLs = [];
        
        // Hide containers
        this.container?.classList.remove('show');
        if (this.multiFileContainer) {
            this.multiFileContainer.innerHTML = '';
        }
    }
}

export default {
    FileListComponent,
    ProgressComponent,
    StatusComponent,
    TransferModeIndicator,
    CopyButton,
    DownloadManager
};
```

- [ ] **Step 4.3: Commit**

```bash
git add js/ui/dragdrop.js js/ui/components.js
git commit -m "feat: add drag-drop handler and UI components"
```

---

## Task 5: CSS Improvements and Responsive Design

**Files:**
- Create: `css/app.css`

### Step 5.1: Create improved CSS with design tokens and responsive design

- [ ] **Write the code**

Create `css/app.css`:

```css
/* ============================================
   DropTransfer - Design Tokens & Base
   ============================================ */

:root {
    /* Colors - Dark theme (default) */
    --bg: #0d1117;
    --surface: #161b22;
    --surface-hover: #21262d;
    --surface-active: #30363d;
    --border: #30363d;
    --border-hover: #58a6ff;
    --text: #c9d1d9;
    --text-secondary: #8b949e;
    --text-muted: #6e7681;
    --accent: #58a6ff;
    --accent-hover: #79b8ff;
    --success: #238636;
    --success-bg: rgba(35, 134, 54, 0.1);
    --error: #da3633;
    --error-bg: rgba(218, 54, 51, 0.1);
    --warning: #d29922;
    --warning-bg: rgba(210, 153, 34, 0.1);
    
    /* Spacing */
    --space-xs: 4px;
    --space-sm: 8px;
    --space-md: 16px;
    --space-lg: 24px;
    --space-xl: 40px;
    
    /* Border radius */
    --radius-sm: 6px;
    --radius-md: 8px;
    --radius-lg: 12px;
    --radius-xl: 16px;
    
    /* Typography */
    --font-sans: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
    --font-mono: 'SF Mono', Monaco, 'Cascadia Code', 'Roboto Mono', Consolas, monospace;
    --text-sm: 0.75rem;
    --text-base: 0.9rem;
    --text-lg: 1rem;
    --text-xl: 1.25rem;
    --text-2xl: 1.5rem;
    
    /* Shadows */
    --shadow-sm: 0 1px 2px rgba(0,0,0,0.1);
    --shadow-md: 0 4px 6px rgba(0,0,0,0.2);
    --shadow-lg: 0 10px 15px rgba(0,0,0,0.3);
    
    /* Transitions */
    --transition-fast: 150ms ease;
    --transition-base: 200ms ease;
}

/* Light theme support */
@media (prefers-color-scheme: light) {
    :root {
        --bg: #ffffff;
        --surface: #f6f8fa;
        --surface-hover: #f3f4f6;
        --surface-active: #e5e7eb;
        --border: #d0d7de;
        --border-hover: #0969da;
        --text: #24292f;
        --text-secondary: #57606a;
        --text-muted: #8c959f;
        --accent: #0969da;
        --accent-hover: #0550ae;
        --success: #1a7f37;
        --error: #cf222e;
        --warning: #9a6700;
    }
}

/* ============================================
   Reset & Base
   ============================================ */

*, *::before, *::after {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
}

html {
    font-size: 16px;
    -webkit-text-size-adjust: 100%;
}

body {
    font-family: var(--font-sans);
    background: var(--bg);
    color: var(--text);
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--space-md);
    line-height: 1.5;
}

/* Focus styles for accessibility */
:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
}

/* ============================================
   Layout Components
   ============================================ */

.container {
    background: var(--surface);
    border-radius: var(--radius-xl);
    padding: var(--space-xl);
    max-width: 500px;
    width: 100%;
    border: 1px solid var(--border);
    box-shadow: var(--shadow-lg);
}

/* Header */
h1 {
    text-align: center;
    margin-bottom: var(--space-xs);
    font-size: var(--text-2xl);
    font-weight: 700;
}

.subtitle {
    text-align: center;
    color: var(--text-secondary);
    margin-bottom: var(--space-md);
    font-size: var(--text-base);
}

/* Badges */
.security-badge {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-sm);
    background: rgba(88, 166, 255, 0.1);
    color: var(--accent);
    padding: var(--space-sm) var(--space-md);
    border-radius: 20px;
    font-size: var(--text-sm);
    margin-bottom: var(--space-md);
    font-weight: 500;
}

.security-badge.encrypted {
    background: var(--success-bg);
    color: var(--success);
}

.speed-badge {
    text-align: center;
    color: var(--success);
    font-size: var(--text-sm);
    margin-bottom: var(--space-md);
}

/* ============================================
   Tabs
   ============================================ */

.tabs {
    display: flex;
    gap: var(--space-xs);
    margin-bottom: var(--space-lg);
    background: var(--bg);
    padding: var(--space-xs);
    border-radius: var(--radius-md);
    border: 1px solid var(--border);
}

.tab {
    flex: 1;
    padding: 10px;
    border: none;
    background: transparent;
    border-radius: var(--radius-sm);
    cursor: pointer;
    color: var(--text-secondary);
    font-size: var(--text-base);
    font-weight: 500;
    transition: all var(--transition-fast);
    position: relative;
}

.tab:hover {
    color: var(--text);
    background: var(--surface-hover);
}

.tab:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
}

.tab.active {
    background: var(--surface-hover);
    color: var(--accent);
    font-weight: 600;
}

.tab-content {
    display: none;
}

.tab-content.active {
    display: block;
}

/* ============================================
   Drop Zone
   ============================================ */

.drop-zone {
    border: 2px dashed var(--border);
    border-radius: var(--radius-lg);
    padding: var(--space-xl) var(--space-md);
    text-align: center;
    cursor: pointer;
    background: var(--bg);
    transition: all var(--transition-base);
    position: relative;
}

.drop-zone:hover,
.drop-zone:focus-visible {
    border-color: var(--accent);
    background: var(--surface-hover);
}

.drop-zone.dragover {
    border-color: var(--accent);
    background: rgba(88, 166, 255, 0.1);
    transform: scale(1.02);
}

.drop-zone .icon {
    font-size: 3rem;
    margin-bottom: var(--space-sm);
    transition: transform var(--transition-base);
}

.drop-zone:hover .icon,
.drop-zone.dragover .icon {
    transform: translateY(-4px);
}

.drop-zone p {
    color: var(--text-secondary);
    font-size: var(--text-base);
    line-height: 1.6;
}

.drop-zone .hint {
    font-size: var(--text-sm);
    margin-top: var(--space-sm);
    color: var(--text-muted);
}

/* State variants */
.drop-zone.state-processing {
    border-color: var(--warning);
    background: var(--warning-bg);
}

.drop-zone.state-ready {
    border-color: var(--success);
    background: var(--success-bg);
}

/* ============================================
   File List
   ============================================ */

.file-list {
    margin-top: var(--space-md);
    max-height: 250px;
    overflow-y: auto;
    scrollbar-width: thin;
    scrollbar-color: var(--border) transparent;
}

.file-list::-webkit-scrollbar {
    width: 6px;
}

.file-list::-webkit-scrollbar-track {
    background: transparent;
}

.file-list::-webkit-scrollbar-thumb {
    background: var(--border);
    border-radius: 3px;
}

.file-card {
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    padding: var(--space-md);
    margin-bottom: var(--space-sm);
    position: relative;
    transition: all var(--transition-fast);
}

.file-card.show {
    display: block;
}

.file-card:hover {
    border-color: var(--accent);
    transform: translateX(2px);
}

.file-card.folder {
    border-color: var(--accent);
    background: rgba(88, 166, 255, 0.05);
}

.file-name {
    font-weight: 600;
    word-break: break-all;
    font-size: var(--text-base);
    padding-right: 24px; /* Space for remove button */
}

.file-path {
    color: var(--text-secondary);
    font-size: var(--text-sm);
    margin-top: 2px;
}

.file-size {
    color: var(--text-secondary);
    font-size: var(--text-sm);
    margin-top: var(--space-xs);
}

.file-count {
    background: var(--accent);
    color: var(--bg);
    padding: 2px 8px;
    border-radius: 12px;
    font-size: var(--text-sm);
    font-weight: 600;
    display: inline-block;
    margin-top: var(--space-xs);
}

.file-remove-btn {
    position: absolute;
    top: var(--space-sm);
    right: var(--space-sm);
    width: 24px;
    height: 24px;
    border: none;
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
    border-radius: var(--radius-sm);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 1.2rem;
    line-height: 1;
    transition: all var(--transition-fast);
}

.file-remove-btn:hover {
    background: var(--error-bg);
    color: var(--error);
}

/* ============================================
   Mode Selector
   ============================================ */

.mode-selector {
    display: flex;
    gap: var(--space-sm);
    margin-bottom: var(--space-md);
}

.mode-btn {
    flex: 1;
    padding: 10px;
    border: 1px solid var(--border);
    background: var(--bg);
    border-radius: var(--radius-md);
    cursor: pointer;
    color: var(--text-secondary);
    font-size: var(--text-sm);
    font-weight: 500;
    transition: all var(--transition-fast);
}

.mode-btn:hover {
    border-color: var(--accent);
    color: var(--text);
}

.mode-btn.active {
    border-color: var(--accent);
    background: rgba(88, 166, 255, 0.1);
    color: var(--accent);
}

/* ============================================
   Code Display
   ============================================ */

.code-box {
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    padding: var(--space-md);
    margin-top: var(--space-md);
    text-align: center;
    display: none;
}

.code-box.show {
    display: block;
    animation: fadeIn 0.3s ease;
}

.code-label {
    color: var(--text-secondary);
    font-size: var(--text-sm);
    margin-bottom: var(--space-sm);
}

.code-value {
    font-family: var(--font-mono);
    font-size: 1.8rem;
    color: var(--accent);
    letter-spacing: 4px;
    cursor: pointer;
    user-select: all;
    padding: var(--space-sm);
    border-radius: var(--radius-sm);
    transition: background var(--transition-fast);
    word-break: break-all;
}

.code-value:hover {
    background: var(--surface-hover);
}

.code-hint {
    color: var(--text-secondary);
    font-size: var(--text-sm);
    margin-top: var(--space-sm);
}

.connection-waiting {
    margin-top: var(--space-md);
    color: var(--text-secondary);
    font-size: var(--text-base);
    animation: pulse 2s infinite;
}

/* ============================================
   Inputs
   ============================================ */

.code-input {
    width: 100%;
    padding: var(--space-md);
    font-size: 1.5rem;
    text-align: center;
    letter-spacing: 4px;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    color: var(--text);
    margin-bottom: var(--space-md);
    font-family: var(--font-mono);
    transition: all var(--transition-fast);
}

.code-input:focus {
    outline: none;
    border-color: var(--accent);
    box-shadow: 0 0 0 3px rgba(88, 166, 255, 0.2);
}

.code-input::placeholder {
    color: var(--text-muted);
}

.code-input:invalid {
    border-color: var(--error);
}

.magnet-input {
    width: 100%;
    padding: var(--space-md);
    font-size: var(--text-sm);
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    color: var(--text);
    margin-bottom: var(--space-md);
    font-family: var(--font-mono);
    transition: all var(--transition-fast);
}

.magnet-input:focus {
    outline: none;
    border-color: var(--accent);
    box-shadow: 0 0 0 3px rgba(88, 166, 255, 0.2);
}

/* ============================================
   Buttons
   ============================================ */

.btn {
    width: 100%;
    padding: 14px;
    background: var(--accent);
    color: var(--bg);
    border: none;
    border-radius: var(--radius-md);
    font-size: var(--text-lg);
    font-weight: 600;
    cursor: pointer;
    transition: all var(--transition-fast);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-sm);
    position: relative;
    overflow: hidden;
}

.btn:hover:not(:disabled) {
    background: var(--accent-hover);
    transform: translateY(-1px);
    box-shadow: var(--shadow-md);
}

.btn:active:not(:disabled) {
    transform: translateY(0);
}

.btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
}

.btn:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
}

.btn-secondary {
    background: var(--surface-hover);
    color: var(--text);
    margin-top: var(--space-md);
}

.btn-secondary:hover:not(:disabled) {
    background: var(--surface-active);
}

.btn-warning {
    background: var(--warning);
    color: var(--bg);
}

.btn-danger {
    background: var(--error);
    color: white;
}

.btn .spinner {
    width: 18px;
    height: 18px;
    border: 2px solid currentColor;
    border-right-color: transparent;
    border-radius: 50%;
    animation: spin 1s linear infinite;
}

/* ============================================
   Progress Bar
   ============================================ */

.progress-bar {
    height: 6px;
    background: var(--bg);
    border-radius: 3px;
    overflow: hidden;
    margin-top: var(--space-md);
    display: none;
}

.progress-bar.show {
    display: block;
}

.progress-fill {
    height: 100%;
    background: var(--accent);
    width: 0%;
    transition: width 0.3s ease;
    border-radius: 3px;
}

.progress-text {
    text-align: center;
    color: var(--text-secondary);
    font-size: var(--text-sm);
    margin-top: var(--space-sm);
    font-family: var(--font-mono);
}

/* ============================================
   Status Messages
   ============================================ */

.status {
    margin-top: var(--space-md);
    padding: var(--space-md);
    border-radius: var(--radius-md);
    text-align: center;
    font-size: var(--text-base);
    display: none;
    animation: slideIn 0.3s ease;
}

.status.show {
    display: block;
}

.status.info {
    background: rgba(88, 166, 255, 0.1);
    color: var(--accent);
    border: 1px solid rgba(88, 166, 255, 0.2);
}

.status.success {
    background: var(--success-bg);
    color: var(--success);
    border: 1px solid rgba(35, 134, 54, 0.2);
}

.status.error {
    background: var(--error-bg);
    color: var(--error);
    border: 1px solid rgba(218, 54, 51, 0.2);
}

.status.warning {
    background: var(--warning-bg);
    color: var(--warning);
    border: 1px solid rgba(210, 153, 34, 0.2);
}

/* ============================================
   Transfer Mode Indicator
   ============================================ */

.transfer-mode-indicator {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-sm);
    padding: var(--space-md);
    border-radius: var(--radius-md);
    font-size: var(--text-sm);
    margin-bottom: var(--space-md);
}

.transfer-mode-indicator.webrtc {
    background: rgba(88, 166, 255, 0.1);
    color: var(--accent);
}

.transfer-mode-indicator.webtorrent {
    background: var(--warning-bg);
    color: var(--warning);
}

.transfer-mode-indicator .link {
    background: none;
    border: none;
    color: var(--accent);
    cursor: pointer;
    text-decoration: underline;
    font-size: inherit;
    padding: 0;
}

/* ============================================
   Download Section
   ============================================ */

.download-box {
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    padding: var(--space-lg);
    margin-top: var(--space-md);
    text-align: center;
    display: none;
    animation: fadeIn 0.3s ease;
}

.download-box.show {
    display: block;
}

.download-btn {
    display: inline-flex;
    align-items: center;
    gap: var(--space-sm);
    background: var(--success);
    color: white;
    padding: 12px 24px;
    border-radius: var(--radius-md);
    text-decoration: none;
    font-weight: 600;
    transition: all var(--transition-fast);
}

.download-btn:hover {
    background: #2ea043;
    transform: translateY(-1px);
    box-shadow: var(--shadow-md);
}

/* ============================================
   Magnet Link Box
   ============================================ */

.magnet-box {
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    padding: var(--space-md);
    margin-top: var(--space-md);
    display: none;
}

.magnet-box.show {
    display: block;
}

.magnet-label {
    color: var(--text-secondary);
    font-size: var(--text-sm);
    margin-bottom: var(--space-sm);
}

.magnet-value {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    color: var(--text);
    word-break: break-all;
    background: var(--surface);
    padding: var(--space-md);
    border-radius: var(--radius-sm);
    cursor: pointer;
    user-select: all;
    max-height: 100px;
    overflow-y: auto;
    scrollbar-width: thin;
}

/* ============================================
   Footer
   ============================================ */

footer {
    text-align: center;
    margin-top: var(--space-lg);
    color: var(--text-secondary);
    font-size: var(--text-sm);
}

footer a {
    color: var(--accent);
    text-decoration: none;
}

footer a:hover {
    text-decoration: underline;
}

/* ============================================
   Animations
   ============================================ */

@keyframes fadeIn {
    from { opacity: 0; transform: translateY(-10px); }
    to { opacity: 1; transform: translateY(0); }
}

@keyframes slideIn {
    from { opacity: 0; transform: translateY(-5px); }
    to { opacity: 1; transform: translateY(0); }
}

@keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
}

@keyframes spin {
    to { transform: rotate(360deg); }
}

/* ============================================
   Responsive Design
   ============================================ */

@media (max-width: 600px) {
    :root {
        --space-xl: 24px;
        --space-lg: 16px;
    }
    
    body {
        padding: var(--space-sm);
        align-items: flex-start;
        padding-top: var(--space-lg);
    }
    
    .container {
        padding: var(--space-lg);
        border-radius: var(--radius-lg);
        min-height: calc(100vh - var(--space-lg) * 2);
    }
    
    h1 {
        font-size: var(--text-xl);
    }
    
    .code-value {
        font-size: 1.25rem;
        letter-spacing: 2px;
    }
    
    .code-input {
        font-size: 1.25rem;
        letter-spacing: 2px;
    }
    
    .drop-zone {
        padding: var(--space-lg) var(--space-md);
    }
    
    .btn {
        padding: 12px;
        font-size: var(--text-base);
    }
    
    /* Larger touch targets on mobile */
    .tab {
        padding: 12px;
        min-height: 44px;
    }
    
    .mode-btn {
        padding: 12px;
        min-height: 44px;
    }
    
    .file-remove-btn {
        width: 32px;
        height: 32px;
    }
}

/* Tablet */
@media (min-width: 601px) and (max-width: 900px) {
    .container {
        max-width: 450px;
    }
}

/* Reduced motion preference */
@media (prefers-reduced-motion: reduce) {
    *, *::before, *::after {
        animation-duration: 0.01ms !important;
        animation-iteration-count: 1 !important;
        transition-duration: 0.01ms !important;
    }
}

/* ============================================
   Utility Classes
   ============================================ */

.hidden { display: none !important; }

.sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
}

.text-center { text-align: center; }
.mt-md { margin-top: var(--space-md); }
.mb-md { margin-bottom: var(--space-md); }
```

- [ ] **Step 5.2: Commit**

```bash
git add css/app.css
git commit -m "feat: add improved CSS with design tokens and responsive design"
```

---

## Task 6: Main Application Module

**Files:**
- Create: `js/app.js`
- Modify: `index.html` - Update to use modular structure

### Step 6.1: Create main application module

- [ ] **Write the code**

Create `js/app.js`:

```javascript
import state from './state.js';
import { isValidCode, formatSize } from './utils.js';
import { PeerJSTransfer } from './transfers/peerjs.js';
import { DragDropHandler } from './ui/dragdrop.js';
import {
    FileListComponent,
    ProgressComponent,
    StatusComponent,
    TransferModeIndicator,
    CopyButton,
    DownloadManager
} from './ui/components.js';

/**
 * DropTransfer Application
 */
class DropTransferApp {
    constructor() {
        this.peerTransfer = new PeerJSTransfer();
        this.dragDrop = null;
        this.fileList = null;
        this.progress = null;
        this.sendStatus = null;
        this.recvStatus = null;
        this.modeIndicator = null;
        this.downloadManager = null;
        
        this.init();
    }
    
    init() {
        // Initialize UI components
        this.dragDrop = new DragDropHandler('dropZone', 'fileInput', 'folderInput', {
            onFilesSelected: (files, isFolder, totalSize) => this.onFilesSelected(files, isFolder, totalSize),
            onError: (errors) => this.onFileErrors(errors),
            maxFileSize: 2 * 1024 * 1024 * 1024 // 2GB
        });
        
        this.fileList = new FileListComponent('fileList');
        this.progress = new ProgressComponent('sendProgress', 'sendProgressText');
        this.sendStatus = new StatusComponent('sendStatus');
        this.recvStatus = new StatusComponent('receiveStatus');
        this.modeIndicator = new TransferModeIndicator('transferModeIndicator');
        this.downloadManager = new DownloadManager('downloadBox', 'multiFileDownloads');
        
        // Copy buttons
        new CopyButton('peerId', this.sendStatus);
        new CopyButton('magnetLink', this.sendStatus);
        
        // Subscribe to state changes
        this.setupStateSubscriptions();
        
        // Bind UI events
        this.bindEvents();
        
        console.log('[App] DropTransfer initialized');
    }
    
    setupStateSubscriptions() {
        // Update UI when progress changes
        state.watch('progress', (progress) => {
            if (progress.bytesTransferred > 0) {
                this.progress.updateFromState(progress);
            }
        });
        
        // Update connection state indicator
        state.watch('connectionState', (state) => {
            if (state === 'connecting') {
                this.modeIndicator.showConnecting();
            } else if (state === 'connected') {
                this.modeIndicator.showWebRTC();
            }
        });
        
        // Show errors
        state.watch('errorMessage', (msg) => {
            if (msg) {
                this.sendStatus.error(msg);
            }
        });
    }
    
    bindEvents() {
        // Global keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            // Escape to cancel/reset
            if (e.key === 'Escape') {
                this.handleReset();
            }
        });
        
        // Visibility change - pause/resume or warn
        document.addEventListener('visibilitychange', () => {
            if (document.hidden && state.get().transferState === 'sending') {
                console.log('[App] Tab hidden - transfer continues in background');
            }
        });
        
        // Before unload warning
        window.addEventListener('beforeunload', (e) => {
            if (state.get().transferState === 'sending' || state.get().transferState === 'receiving') {
                e.preventDefault();
                e.returnValue = 'Transfer in progress. Are you sure you want to leave?';
            }
        });
    }
    
    // ==================== File Selection ====================
    
    onFilesSelected(files, isFolder, totalSize) {
        this.fileList.render(files, isFolder);
        this.sendStatus.info(`${files.length} file(s) selected (${formatSize(totalSize)})`);
        
        // Auto-init sender for direct mode
        if (state.get().sendMode === 'direct') {
            this.initSender();
        }
    }
    
    onFileErrors(errors) {
        if (errors.length > 0) {
            this.sendStatus.error(errors.join('. '));
        }
    }
    
    // ==================== Sender ====================
    
    async initSender() {
        const files = state.get().selectedFiles;
        if (!files || files.length === 0) {
            this.sendStatus.error('Please select files first');
            return;
        }
        
        this.sendStatus.info('Creating peer connection...');
        this.progress.show();
        
        await this.peerTransfer.initSender(
            (peerId) => {
                document.getElementById('peerId').textContent = peerId;
                document.getElementById('codeBox').classList.add('show');
                document.getElementById('connectionWaiting').style.display = 'block';
                this.sendStatus.success('Ready! Share the code with the receiver');
            },
            (err) => {
                this.sendStatus.error('Connection error: ' + err.message);
                document.getElementById('connectionWaiting').style.display = 'none';
            }
        );
        
        // Setup receiver-ready handler
        this.peerTransfer.conn?.on('data', (data) => {
            if (data === 'ready') {
                document.getElementById('connectionWaiting').style.display = 'none';
                this.sendFiles();
            }
        });
    }
    
    async sendFiles() {
        const files = state.get().selectedFiles;
        
        await this.peerTransfer.sendFiles(
            files,
            (bytesSent, totalBytes, speed) => {
                // Progress callback
            },
            () => {
                // Complete callback
                this.sendStatus.success('Transfer complete!');
                document.getElementById('resetBtn').style.display = 'block';
                document.getElementById('resetBtn').disabled = false;
            },
            (err) => {
                // Error callback
                this.sendStatus.error('Transfer failed: ' + err.message);
                document.getElementById('resetBtn').style.display = 'block';
                document.getElementById('resetBtn').disabled = false;
            }
        );
    }
    
    // ==================== Receiver ====================
    
    async connect() {
        const code = document.getElementById('codeInput').value.trim();
        
        if (!code) {
            this.recvStatus.error('Please enter a transfer code');
            return;
        }
        
        if (!isValidCode(code)) {
            this.recvStatus.error('Invalid code format');
            return;
        }
        
        document.getElementById('connectBtn').disabled = true;
        this.recvStatus.info('Connecting...');
        this.modeIndicator.showConnecting();
        
        await this.peerTransfer.initReceiver(
            code,
            (bytesReceived, totalBytes, speed) => {
                // Progress callback
            },
            (files) => {
                // Complete callback
                this.recvStatus.success('Transfer complete!');
                this.downloadManager.createDownload(files);
                document.getElementById('retryBtn').style.display = 'block';
                document.getElementById('retryBtn').textContent = '🔄 Receive Another File';
            },
            (err) => {
                // Error callback
                this.recvStatus.error(err.message);
                this.modeIndicator.showError(true);
                document.getElementById('retryBtn').style.display = 'block';
            }
        );
    }
    
    // ==================== Reset ====================
    
    handleReset() {
        this.peerTransfer.cleanup();
        this.dragDrop.reset();
        this.fileList.clear();
        this.progress.reset();
        this.downloadManager.clear();
        this.modeIndicator.hide();
        
        // Reset UI elements
        document.getElementById('codeBox').classList.remove('show');
        document.getElementById('magnetBox').classList.remove('show');
        document.getElementById('codeInput').value = '';
        document.getElementById('connectBtn').disabled = false;
        document.getElementById('connectBtn').style.display = 'block';
        document.getElementById('retryBtn').style.display = 'none';
        document.getElementById('connectionWaiting').style.display = 'none';
        
        this.sendStatus.hide();
        this.recvStatus.hide();
        
        state.reset();
    }
}

// Mode switching (global for onclick handlers)
window.switchTab = (tab, btn) => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(tab + '-tab').classList.add('active');
};

window.setSendMode = (mode) => {
    state.set({ sendMode: mode });
    document.querySelectorAll('#send-tab .mode-btn').forEach(b => b.classList.remove('active'));
    document.getElementById(mode === 'direct' ? 'modeDirect' : 'modeTorrent').classList.add('active');
};

window.setRecvMode = (mode) => {
    state.set({ recvMode: mode });
    document.querySelectorAll('#receive-tab .mode-btn').forEach(b => b.classList.remove('active'));
    document.getElementById(mode === 'direct' ? 'recvModeDirect' : 'recvModeTorrent').classList.add('active');
    document.getElementById('directReceiveSection').style.display = mode === 'direct' ? 'block' : 'none';
    document.getElementById('torrentReceiveSection').style.display = mode === 'torrent' ? 'block' : 'none';
};

// Initialize app when DOM is ready
let app;
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        app = new DropTransferApp();
    });
} else {
    app = new DropTransferApp();
}

// Expose for debugging
window.dropTransfer = app;
export default app;
```

### Step 6.2: Update index.html to use new modular structure

- [ ] **Update the HTML**

Create the new `index.html` structure (keep the essential parts, update to use modules):

Key changes needed:
1. Add `type="module"` to script tags
2. Link to the new CSS file
3. Remove inline scripts (move to modules)
4. Add data attributes for element selection
5. Keep service worker registration inline (needs to be non-module)

Since this is a significant rewrite, here's the approach: Keep the existing structure but:
1. Replace the `<style>` with `<link rel="stylesheet" href="css/app.css">`
2. Replace the main script with `<script type="module" src="js/app.js"></script>`
3. Keep the service worker registration script inline (before the module)
4. Add any missing ID attributes needed by the new JS

Let me write the new HTML:

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="description" content="Secure P2P file sharing with end-to-end encryption">
    <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'unsafe-inline' https://unpkg.com https://cdn.jsdelivr.net https://cdnjs.cloudflare.com; style-src 'self' 'unsafe-inline'; connect-src *; media-src blob:; img-src data: blob:; worker-src 'self';">
    
    <title>DropTransfer - Secure P2P File Sharing</title>
    
    <link rel="manifest" href="./manifest.json">
    <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Crect width='100' height='100' fill='%230d1117' rx='20'/%3E%3Ctext x='50' y='65' font-size='50' text-anchor='middle'%3E📦%3C/text%3E%3C/svg%3E">
    
    <!-- External libraries -->
    <script src="https://unpkg.com/peerjs@1.5.2/dist/peerjs.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/webtorrent@2.8.5/webtorrent.min.js" crossorigin="anonymous"></script>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js"></script>
    
    <!-- App styles -->
    <link rel="stylesheet" href="css/app.css">
</head>
<body>
    <div class="container">
        <h1>📦 DropTransfer</h1>
        <p class="subtitle">Secure P2P file sharing with end-to-end encryption</p>
        
        <div class="security-badge" id="securityBadge">🔐 End-to-end encryption enabled</div>
        <div class="speed-badge" id="speedBadge" style="display: none;">⚡ High-speed transfer active</div>
        
        <div class="tabs">
            <button class="tab active" onclick="switchTab('send', this)">Send</button>
            <button class="tab" onclick="switchTab('receive', this)">Receive</button>
        </div>
        
        <!-- Send Tab -->
        <div class="tab-content active" id="send-tab">
            <div class="mode-selector">
                <button class="mode-btn active" id="modeDirect" onclick="setSendMode('direct')">Direct P2P</button>
                <button class="mode-btn" id="modeTorrent" onclick="setSendMode('torrent')">WebTorrent</button>
            </div>
            
            <div class="drop-zone" id="dropZone" role="button" tabindex="0">
                <div class="icon">📤</div>
                <p>Drop files or folders here<br>or click to browse</p>
                <p class="hint">Click to select files • Right-click for folder</p>
            </div>
            <input type="file" id="fileInput" multiple style="display: none;">
            <input type="file" id="folderInput" webkitdirectory directory style="display: none;">
            
            <div class="file-list" id="fileList"></div>
            
            <div class="code-box" id="codeBox">
                <div class="code-label">Your transfer code:</div>
                <div class="code-value" id="peerId" title="Click to copy"></div>
                <div class="code-hint">Share this code with receiver</div>
                <div class="connection-waiting" id="connectionWaiting" style="display: none;">⏳ Waiting for receiver...</div>
            </div>
            
            <div class="magnet-box" id="magnetBox">
                <div class="magnet-label">Magnet link (click to copy):</div>
                <div class="magnet-value" id="magnetLink" title="Click to copy"></div>
            </div>
            
            <div class="progress-bar" id="sendProgress">
                <div class="progress-fill" id="sendProgressFill"></div>
            </div>
            <div class="progress-text" id="sendProgressText"></div>
            <div class="status" id="sendStatus"></div>
            
            <button class="btn btn-secondary" id="resetBtn" onclick="window.dropTransfer.handleReset()" style="display: none;">🔄 Send Another File</button>
        </div>
        
        <!-- Receive Tab -->
        <div class="tab-content" id="receive-tab">
            <div class="mode-selector">
                <button class="mode-btn active" id="recvModeDirect" onclick="setRecvMode('direct')">Direct P2P</button>
                <button class="mode-btn" id="recvModeTorrent" onclick="setRecvMode('torrent')">WebTorrent</button>
            </div>
            
            <div id="directReceiveSection">
                <input type="text" class="code-input" id="codeInput" placeholder="ENTER CODE" maxlength="20" autocomplete="off">
                <button class="btn" id="connectBtn" onclick="window.dropTransfer.connect()">Connect & Download</button>
            </div>
            
            <div id="torrentReceiveSection" style="display: none;">
                <input type="text" class="magnet-input" id="magnetInput" placeholder="Paste magnet link here...">
                <button class="btn" id="torrentBtn">Download via WebTorrent</button>
            </div>
            
            <button class="btn btn-secondary" id="retryBtn" onclick="window.dropTransfer.handleReset()" style="display: none;">🔄 Try Again</button>
            
            <div class="transfer-mode-indicator" id="transferModeIndicator" style="display: none;"></div>
            
            <div class="progress-bar" id="receiveProgress">
                <div class="progress-fill" id="receiveProgressFill"></div>
            </div>
            <div class="progress-text" id="receiveProgressText"></div>
            
            <div class="download-box" id="downloadBox">
                <a class="download-btn" id="downloadLink" href="#" download>⬇️ Download File</a>
            </div>
            
            <div id="multiFileDownloads"></div>
            <div class="status" id="receiveStatus"></div>
        </div>
        
        <footer>
            Built with ❤️ by QQ & Nova ☄️<br>
            <small>🔐 Encrypted • 🌐 P2P + WebTorrent Fallback</small>
        </footer>
    </div>

    <!-- Service Worker Registration (non-module) -->
    <script>
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.register('./sw.js')
                .then(reg => console.log('[SW] Registered:', reg.scope))
                .catch(err => console.error('[SW] Registration failed:', err));
        }
    </script>
    
    <!-- Main App Module -->
    <script type="module" src="js/app.js"></script>
</body>
</html>
```

- [ ] **Step 6.3: Commit**

```bash
git add js/app.js index.html
git commit -m "feat: add main application module and update HTML structure"
```

---

## Task 7: WebTorrent Transfer Module

**Files:**
- Create: `js/transfers/webtorrent.js`

### Step 7.1: Create WebTorrent transfer module

- [ ] **Write the code**

Create `js/transfers/webtorrent.js`:

```javascript
import state from '../state.js';
import { formatSize } from '../utils.js';

// Default WebTorrent trackers
const DEFAULT_TRACKERS = [
    'wss://tracker.openwebtorrent.com',
    'wss://tracker.files.fm:7073/announce',
    'wss://spacetradersapi-chatbox.fly.dev:443/announce'
];

const SEED_TIMEOUT = 60000; // 60 seconds to create torrent
const DOWNLOAD_TIMEOUT = 120000; // 2 minutes to find peers

/**
 * WebTorrent Transfer Manager
 */
export class WebTorrentTransfer {
    constructor() {
        this.client = null;
        this.activeTorrents = [];
        this.objectURLs = [];
    }
    
    /**
     * Get or create WebTorrent client
     */
    getClient() {
        if (!this.client) {
            this.client = new WebTorrent({
                tracker: {
                    rtcConfig: {
                        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
                    }
                }
            });
            
            this.client.on('error', (err) => {
                console.error('[WebTorrent] Client error:', err);
                state.set({ errorMessage: 'WebTorrent error: ' + err.message });
            });
        }
        return this.client;
    }
    
    /**
     * Create a torrent from files
     * @param {Array} files - Array of {file, path}
     * @param {Function} onProgress - Progress callback
     * @param {Function} onReady - Called with magnet URI when ready
     * @param {Function} onError - Error callback
     */
    async seed(files, onProgress, onReady, onError) {
        if (!files || files.length === 0) {
            onError?.(new Error('No files selected'));
            return;
        }
        
        try {
            state.set({ transferState: 'preparing' });
            
            const client = this.getClient();
            const fileObjects = files.map(f => f.file);
            
            const opts = {
                name: files.length === 1 ? files[0].file.name : 'DropTransfer',
                announceList: DEFAULT_TRACKERS.map(t => [t])
            };
            
            // Timeout for torrent creation
            const timeout = setTimeout(() => {
                onError?.(new Error('Timeout creating torrent'));
            }, SEED_TIMEOUT);
            
            client.seed(fileObjects, opts, (torrent) => {
                clearTimeout(timeout);
                
                console.log('[WebTorrent] Seeding:', torrent.infoHash);
                this.activeTorrents.push(torrent);
                
                state.set({ 
                    transferState: 'sending',
                    peerId: torrent.magnetURI
                });
                
                onReady?.(torrent.magnetURI, torrent);
                
                // Track upload progress
                torrent.on('upload', () => {
                    onProgress?.(torrent.uploaded, torrent.length, torrent.uploadSpeed);
                });
                
                torrent.on('wire', (wire) => {
                    console.log('[WebTorrent] New peer:', wire.remoteAddress);
                });
                
                torrent.on('error', (err) => {
                    console.error('[WebTorrent] Torrent error:', err);
                    onError?.(err);
                });
            });
            
        } catch (err) {
            console.error('[WebTorrent] Seed failed:', err);
            onError?.(err);
        }
    }
    
    /**
     * Download from magnet link
     * @param {string} magnetURI - Magnet link
     * @param {Function} onProgress - Progress callback(bytes, total, speed)
     * @param {Function} onComplete - Completion callback(files)
     * @param {Function} onError - Error callback
     */
    async download(magnetURI, onProgress, onComplete, onError) {
        if (!magnetURI || !magnetURI.startsWith('magnet:')) {
            onError?.(new Error('Invalid magnet link'));
            return;
        }
        
        if (!magnetURI.includes('xt=urn:btih:')) {
            onError?.(new Error('Invalid magnet link: missing info hash'));
            return;
        }
        
        try {
            state.set({ transferState: 'receiving' });
            
            const client = this.getClient();
            let timeout;
            
            const cleanup = () => {
                if (timeout) clearTimeout(timeout);
            };
            
            // Timeout for finding peers
            timeout = setTimeout(() => {
                cleanup();
                onError?.(new Error('No peers found. Make sure the sender is online.'));
            }, DOWNLOAD_TIMEOUT);
            
            client.add(magnetURI, (torrent) => {
                console.log('[WebTorrent] Downloading:', torrent.name);
                
                // Clear timeout once we have metadata
                clearTimeout(timeout);
                
                this.activeTorrents.push(torrent);
                
                torrent.on('download', () => {
                    onProgress?.(torrent.downloaded, torrent.length, torrent.downloadSpeed);
                });
                
                torrent.on('done', () => {
                    cleanup();
                    console.log('[WebTorrent] Download complete');
                    
                    const files = torrent.files.map(file => ({
                        name: file.name,
                        size: file.length,
                        getBlob: () => new Promise((resolve, reject) => {
                            file.getBlob((err, blob) => {
                                if (err) reject(err);
                                else resolve(blob);
                            });
                        })
                    }));
                    
                    state.set({ transferState: 'completed' });
                    onComplete?.(files, torrent);
                });
                
                torrent.on('error', (err) => {
                    cleanup();
                    console.error('[WebTorrent] Torrent error:', err);
                    onError?.(err);
                });
                
                torrent.on('warning', (err) => {
                    console.warn('[WebTorrent] Warning:', err);
                });
            });
            
        } catch (err) {
            console.error('[WebTorrent] Download failed:', err);
            onError?.(err);
        }
    }
    
    /**
     * Cancel all active transfers
     */
    cancel() {
        this.activeTorrents.forEach(torrent => {
            torrent.destroy();
        });
        this.activeTorrents = [];
    }
    
    /**
     * Clean up all resources
     */
    cleanup() {
        this.cancel();
        
        // Revoke object URLs
        this.objectURLs.forEach(url => URL.revokeObjectURL(url));
        this.objectURLs = [];
        
        // Destroy client
        if (this.client) {
            this.client.destroy();
            this.client = null;
        }
    }
}

export default WebTorrentTransfer;
```

- [ ] **Step 7.2: Commit**

```bash
git add js/transfers/webtorrent.js
git commit -m "feat: add WebTorrent transfer module"
```

---

## Task 8: Integration Testing and Polish

### Step 8.1: Add error boundaries and final polish to app.js

- [ ] **Modify `js/app.js`**

Add WebTorrent support to the main app:

```javascript
// Add to imports at top of js/app.js
import { WebTorrentTransfer } from './transfers/webtorrent.js';

// Add to constructor
this.webtorrentTransfer = new WebTorrentTransfer();

// Add methods for WebTorrent mode
window.initTorrentSender = () => {
    const files = state.get().selectedFiles;
    if (!files.length) {
        app.sendStatus.error('Please select files first');
        return;
    }
    
    app.sendStatus.info('Creating torrent...');
    
    app.webtorrentTransfer.seed(
        files,
        (uploaded, total, speed) => {
            const percent = (uploaded / total) * 100;
            app.progress.update(percent, `Seeding... ${formatSize(speed)}/s`);
        },
        (magnetURI) => {
            document.getElementById('magnetLink').textContent = magnetURI;
            document.getElementById('magnetBox').classList.add('show');
            app.sendStatus.success('Torrent ready! Share the magnet link');
            document.getElementById('resetBtn').style.display = 'block';
        },
        (err) => {
            app.sendStatus.error('Failed to create torrent: ' + err.message);
        }
    );
};

window.downloadTorrent = () => {
    const magnet = document.getElementById('magnetInput').value.trim();
    
    app.recvStatus.info('Connecting to peers...');
    app.modeIndicator.showWebTorrent();
    
    app.webtorrentTransfer.download(
        magnet,
        (downloaded, total, speed) => {
            const percent = (downloaded / total) * 100;
            app.progress.update(percent, `Downloading... ${Math.round(percent)}% • ${formatSize(speed)}/s`);
        },
        async (files) => {
            app.recvStatus.success('Download complete!');
            
            // Convert to blobs and create downloads
            const fileBlobs = await Promise.all(
                files.map(async (f) => ({
                    name: f.name,
                    blob: await f.getBlob(),
                    size: f.size
                }))
            );
            
            app.downloadManager.createDownload(fileBlobs);
            document.getElementById('retryBtn').style.display = 'block';
        },
        (err) => {
            app.recvStatus.error(err.message);
            document.getElementById('retryBtn').style.display = 'block';
        }
    );
};
```

- [ ] **Step 8.2: Commit**

```bash
git add js/app.js
git commit -m "feat: integrate WebTorrent transfer support"
```

---

## Summary of Changes

### Stability Improvements
1. **Centralized state management** - Prevents inconsistent UI states
2. **Proper cleanup** - Object URLs and connections cleaned up correctly
3. **Backpressure handling** - Prevents buffer overflow in data channels
4. **Chunk acknowledgment** - Reliable transfer with retry logic
5. **Connection timeouts** - Prevents hanging connections
6. **Error boundaries** - Graceful degradation

### Usability Improvements
1. **Visual feedback** - Drag states, progress animations, copy confirmations
2. **Responsive design** - Works on mobile and desktop
3. **Keyboard navigation** - Tab navigation and shortcuts (Escape to cancel)
4. **Accessibility** - ARIA labels, focus states, screen reader support
5. **File icons** - Visual identification of file types
6. **Better progress** - Speed, ETA, and byte counts
7. **Cancel support** - Abort in-progress transfers
8. **File validation** - Size limits and error messages

### Code Quality
1. **Modular architecture** - Clear separation of concerns
2. **ES6 modules** - Modern JavaScript with proper imports/exports
3. **Design tokens** - Consistent CSS variables
4. **Reduced motion** - Respects user preferences
5. **Light/dark mode** - Automatic theme detection

---

## Testing Checklist

Before deployment, verify:

- [ ] File selection (click, drag-drop, folder)
- [ ] Direct P2P transfer between two browsers
- [ ] WebTorrent fallback mode
- [ ] Cancel transfer mid-operation
- [ ] Large file handling (>100MB)
- [ ] Mobile device compatibility
- [ ] Keyboard navigation (Tab, Enter, Escape)
- [ ] Copy code functionality
- [ ] Error states (invalid code, disconnected peer)
- [ ] Service worker caching
