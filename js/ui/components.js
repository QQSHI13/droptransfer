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

        if (isFolder || files.length > 1) {
            const summaryCard = document.createElement('div');
            summaryCard.className = 'file-card folder show';
            summaryCard.innerHTML = `
                <div class="file-name">📁 ${isFolder ? 'Folder' : 'Multiple Files'}</div>
                <div class="file-count">${files.length} files • ${formatSize(totalSize)}</div>
            `;
            this.container.appendChild(summaryCard);

            files.slice(0, this.options.maxPreview).forEach((f, idx) => {
                this.container.appendChild(this._createFileCard(f, idx));
            });

            if (files.length > this.options.maxPreview) {
                const moreCard = document.createElement('div');
                moreCard.className = 'file-card show';
                moreCard.style.textAlign = 'center';
                moreCard.style.color = 'var(--text-secondary)';
                moreCard.textContent = `... and ${files.length - this.options.maxPreview} more files`;
                this.container.appendChild(moreCard);
            }
        } else {
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
        this.objectURLs.forEach(url => URL.revokeObjectURL(url));
        this.objectURLs = [];

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
