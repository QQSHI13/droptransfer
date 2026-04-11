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
            sendMode: 'direct',
            recvMode: 'direct',
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
