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
const HEARTBEAT_INTERVAL = 10000; // 10 seconds
const HEARTBEAT_TIMEOUT = 30000; // 30 seconds (3 missed heartbeats)

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

        // Connection health monitoring
        this.heartbeatTimer = null;
        this.lastHeartbeatReceived = 0;
        this.connectionMetrics = {
            rtt: [],
            connectionType: 'unknown',
            packetsLost: 0,
            startTime: null
        };

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
            // Compute file hashes for integrity verification
            const fileHashes = await Promise.all(
                files.map(async (f) => {
                    const hash = await this._computeFileHash(f.file);
                    return { index: files.indexOf(f), hash };
                })
            );

            // Send metadata with hashes
            const metadata = {
                type: 'metadata',
                fileCount: files.length,
                files: files.map((f, i) => ({ 
                    name: f.file.name, 
                    path: f.path, 
                    size: f.file.size,
                    hash: fileHashes.find(h => h.index === i)?.hash 
                })),
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
        // Stop heartbeat
        this._stopHeartbeat();

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

    // Heartbeat & Connection Health

    _startHeartbeat() {
        this.lastHeartbeatReceived = Date.now();
        this.connectionMetrics.startTime = Date.now();

        // Send heartbeat every 10 seconds
        this.heartbeatTimer = setInterval(() => {
            if (this.conn?.open) {
                this.conn.send({ type: 'ping', timestamp: Date.now() });

                // Check if we've missed heartbeats
                const elapsed = Date.now() - this.lastHeartbeatReceived;
                if (elapsed > HEARTBEAT_TIMEOUT) {
                    console.warn('[PeerJS] Connection appears dead (no heartbeat for', elapsed, 'ms)');
                    state.set({ errorMessage: 'Connection lost. Transfer may have failed.' });
                    this.cleanup();
                }
            }
        }, HEARTBEAT_INTERVAL);
    }

    _stopHeartbeat() {
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = null;
        }
    }

    _handleHeartbeat(data) {
        if (data.type === 'ping') {
            // Respond with pong
            if (this.conn?.open) {
                this.conn.send({ type: 'pong', timestamp: data.timestamp });
            }
        } else if (data.type === 'pong') {
            // Calculate RTT
            const rtt = Date.now() - data.timestamp;
            this.connectionMetrics.rtt.push(rtt);
            this.lastHeartbeatReceived = Date.now();

            // Keep only last 10 RTT samples
            if (this.connectionMetrics.rtt.length > 10) {
                this.connectionMetrics.rtt.shift();
            }

            // Detect connection type from first successful pong
            if (this.connectionMetrics.connectionType === 'unknown' && this.conn?.peerConnection) {
                const stats = this.conn.peerConnection.getStats();
                stats.then(report => {
                    report.forEach(stat => {
                        if (stat.type === 'candidate-pair' && stat.state === 'succeeded') {
                            const local = report.get(stat.localCandidateId);
                            const remote = report.get(stat.remoteCandidateId);
                            if (local && remote) {
                                const isRelay = local.candidateType === 'relay' || remote.candidateType === 'relay';
                                this.connectionMetrics.connectionType = isRelay ? 'relay' : 'direct';
                                console.log('[PeerJS] Connection type:', this.connectionMetrics.connectionType);
                            }
                        }
                    });
                });
            }
        }
    }

    getConnectionMetrics() {
        const avgRtt = this.connectionMetrics.rtt.length > 0
            ? Math.round(this.connectionMetrics.rtt.reduce((a, b) => a + b, 0) / this.connectionMetrics.rtt.length)
            : null;

        return {
            rtt: avgRtt,
            connectionType: this.connectionMetrics.connectionType,
            uptime: this.connectionMetrics.startTime ? Date.now() - this.connectionMetrics.startTime : 0
        };
    }

    // Private methods

    _handleIncomingConnection(connection, onError) {
        console.log('[PeerJS] Incoming connection from:', connection.peer);

        this.conn = connection;
        this.conn.serialization = 'binary';
        this.conn.reliable = true;

        // Derive encryption key before accepting data
        deriveKey(this.peer.id, connection.peer)
            .then(key => {
                this.encryptionKey = key;
                console.log('[PeerJS] Encryption established');

                // Now safe to accept data
                this.conn.on('data', (data) => this._handleData(data));
            })
            .catch(err => {
                console.error('[PeerJS] Key derivation failed:', err);
                this.conn.on('data', (data) => this._handleData(data));
            });

        this.conn.on('error', (err) => {
            clearTimeout(this.connectionTimeout);
            console.error('[PeerJS] Connection error:', err);
            state.set({ connectionState: 'error', errorMessage: err.message });
            onError?.(err);
        });

        this.conn.on('close', () => {
            clearTimeout(this.connectionTimeout);
            this._stopHeartbeat();
            console.log('[PeerJS] Connection closed');
            state.set({ connectionState: 'disconnected' });
        });

        this._startHeartbeat();
        state.set({ connectionState: 'connected' });
    }

    _setupReceiverConnection(code, onProgress, onComplete, onError) {
        this.conn.on('open', async () => {
            console.log('[PeerJS] Connected to sender');
            clearTimeout(this.connectionTimeout);

            state.set({ connectionState: 'connected' });

            try {
                this.encryptionKey = await deriveKey(code, this.peer.id);
                this.conn.send('ready');
            } catch (err) {
                console.error('[PeerJS] Key derivation failed:', err);
                this.conn.send('ready'); // Continue unencrypted if key fails
            }

            this._startHeartbeat();
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
                if (!this.conn?.open) {
                    throw new Error('Connection closed while waiting for acknowledgments');
                }
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
        // Handle heartbeat messages
        if (data && (data.type === 'ping' || data.type === 'pong')) {
            this._handleHeartbeat(data);
            return;
        }

        if (data === 'ready') {
            console.log('[PeerJS] Receiver ready');
            state.set({ transferState: 'sending' });
        } else if (data === 'received') {
            console.log('[PeerJS] Transfer acknowledged by receiver');
            state.set({ transferState: 'completed' });
        } else if (data?.type === 'ack') {
            const ackKey = `${data.fileIndex}-${data.chunkIndex}`;
            this.pendingAcks.delete(ackKey);
        } else if (data?.type === 'hashVerify') {
            // Receiver is verifying file hash
            console.log('[PeerJS] Hash verification result:', data.verified ? 'PASS' : 'FAIL');
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
                    await this._saveCurrentFile();
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
                await this._saveCurrentFile();
                break;

            case 'done':
                if (this.receivedChunks.length > 0) {
                    await this._saveCurrentFile();
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
                this.conn?.send({ type: 'error', message: 'Decryption failed' });
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

    async _saveCurrentFile() {
        if (this.receivedChunks.length === 0) return;

        const blob = new Blob(this.receivedChunks);
        const fileInfo = this.fileInfo.files[this.currentFileIndex];

        // Verify file integrity if hash was provided
        let hashVerified = true;
        if (fileInfo.hash) {
            const computedHash = await this._computeHash(blob);
            hashVerified = computedHash === fileInfo.hash;
            if (!hashVerified) {
                console.error('[PeerJS] Hash mismatch for file:', fileInfo.name);
                state.set({ errorMessage: `File integrity check failed for ${fileInfo.name}` });
            } else {
                console.log('[PeerJS] Hash verified for file:', fileInfo.name);
            }
        }

        this.receivedFiles.push({
            blob,
            name: fileInfo.name,
            path: fileInfo.path,
            size: blob.size,
            hashVerified
        });

        // Report hash verification result to sender
        if (this.conn?.open && fileInfo.hash) {
            this.conn.send({ type: 'hashVerify', fileIndex: this.currentFileIndex, verified: hashVerified });
        }

        this.receivedChunks = [];
    }

    /**
     * Compute SHA-256 hash of a Blob/File
     */
    async _computeHash(blob) {
        const buffer = await blob.arrayBuffer();
        const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }

    /**
     * Compute SHA-256 hash of a File object
     */
    async _computeFileHash(file) {
        const buffer = await file.arrayBuffer();
        const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }
}

export default PeerJSTransfer;
