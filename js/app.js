import state from './state.js';
import { isValidCode, formatSize } from './utils.js';
import { PeerJSTransfer } from './transfers/peerjs.js';
import { WebTorrentTransfer } from './transfers/webtorrent.js';
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
        this.webtorrentTransfer = new WebTorrentTransfer();
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
            maxFileSize: 2 * 1024 * 1024 * 1024
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
            if (e.key === 'Escape') {
                this.handleReset();
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

    onFilesSelected(files, isFolder, totalSize) {
        this.fileList.render(files, isFolder);
        this.sendStatus.info(`${files.length} file(s) selected (${formatSize(totalSize)})`);

        const sendMode = state.get().sendMode;
        if (sendMode === 'direct') {
            this.initSender();
        } else if (sendMode === 'torrent') {
            this.initTorrentSender();
        }
    }

    onFileErrors(errors) {
        if (errors.length > 0) {
            this.sendStatus.error(errors.join('. '));
        }
    }

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
            (bytesSent, totalBytes, speed) => {},
            () => {
                this.sendStatus.success('Transfer complete!');
                document.getElementById('resetBtn').style.display = 'block';
                document.getElementById('resetBtn').disabled = false;
            },
            (err) => {
                this.sendStatus.error('Transfer failed: ' + err.message);
                document.getElementById('resetBtn').style.display = 'block';
                document.getElementById('resetBtn').disabled = false;
            }
        );
    }

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
            (bytesReceived, totalBytes, speed) => {},
            (files) => {
                this.recvStatus.success('Transfer complete!');
                this.downloadManager.createDownload(files);
                document.getElementById('retryBtn').style.display = 'block';
                document.getElementById('retryBtn').textContent = '🔄 Receive Another File';
            },
            (err) => {
                this.recvStatus.error(err.message);
                this.modeIndicator.showError(true);
                document.getElementById('retryBtn').style.display = 'block';
            }
        );
    }

    async initTorrentSender() {
        const files = state.get().selectedFiles;
        if (!files.length) {
            this.sendStatus.error('Please select files first');
            return;
        }

        this.sendStatus.info('Creating torrent...');
        this.progress.show();

        this.webtorrentTransfer.seed(
            files,
            (uploaded, total, speed) => {
                const percent = total > 0 ? (uploaded / total) * 100 : 0;
                this.progress.update(percent, `Seeding... ${formatSize(speed)}/s`);
            },
            (magnetURI) => {
                document.getElementById('magnetLink').textContent = magnetURI;
                document.getElementById('magnetBox').classList.add('show');
                this.sendStatus.success('Torrent ready! Share the magnet link');
                document.getElementById('resetBtn').style.display = 'block';
            },
            (err) => {
                this.sendStatus.error('Failed to create torrent: ' + err.message);
            }
        );
    }

    async downloadTorrent() {
        const magnet = document.getElementById('magnetInput').value.trim();

        if (!magnet) {
            this.recvStatus.error('Please enter a magnet link');
            return;
        }

        document.getElementById('torrentBtn').disabled = true;
        this.recvStatus.info('Connecting to peers...');
        this.modeIndicator.showWebTorrent();
        this.progress.show();

        this.webtorrentTransfer.download(
            magnet,
            (downloaded, total, speed) => {
                const percent = total > 0 ? (downloaded / total) * 100 : 0;
                this.progress.update(percent, `Downloading... ${Math.round(percent)}% • ${formatSize(speed)}/s`);
            },
            async (files) => {
                this.recvStatus.success('Download complete!');

                const fileBlobs = await Promise.all(
                    files.map(async (f) => ({
                        name: f.name,
                        blob: await f.getBlob(),
                        size: f.size
                    }))
                );

                this.downloadManager.createDownload(fileBlobs);
                document.getElementById('torrentBtn').disabled = false;
                document.getElementById('retryBtn').style.display = 'block';
            },
            (err) => {
                this.recvStatus.error(err.message);
                document.getElementById('torrentBtn').disabled = false;
                document.getElementById('retryBtn').style.display = 'block';
            }
        );
    }

    handleReset() {
        this.peerTransfer.cleanup();
        this.webtorrentTransfer.cleanup();
        this.dragDrop.reset();
        this.fileList.clear();
        this.progress.reset();
        this.downloadManager.clear();
        this.modeIndicator.hide();

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

// Global functions for onclick handlers
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

window.initTorrentSender = () => app.initTorrentSender();
window.downloadTorrent = () => app.downloadTorrent();

// Initialize app
let app;
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        app = new DropTransferApp();
    });
} else {
    app = new DropTransferApp();
}

window.dropTransfer = app;
export default app;
