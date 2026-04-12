import state from '../state.js';
import { deriveKey, encryptChunk, decryptChunk, generateIV } from '../crypto.js';
import { formatSize } from '../utils.js';

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
