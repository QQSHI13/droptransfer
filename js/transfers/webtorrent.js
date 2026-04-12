import state from '../state.js';
import { formatSize } from '../utils.js';

// Default WebTorrent trackers
const DEFAULT_TRACKERS = [
    'wss://tracker.openwebtorrent.com',
    'wss://tracker.files.fm:7073/announce',
    'wss://spacetradersapi-chatbox.fly.dev:443/announce'
];

const SEED_TIMEOUT = 60000;
const DOWNLOAD_TIMEOUT = 120000;

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

            timeout = setTimeout(() => {
                cleanup();
                onError?.(new Error('No peers found. Make sure the sender is online.'));
            }, DOWNLOAD_TIMEOUT);

            client.add(magnetURI, (torrent) => {
                clearTimeout(timeout);

                console.log('[WebTorrent] Downloading:', torrent.name);
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

        this.objectURLs.forEach(url => URL.revokeObjectURL(url));
        this.objectURLs = [];

        if (this.client) {
            this.client.destroy();
            this.client = null;
        }
    }
}

export default WebTorrentTransfer;
