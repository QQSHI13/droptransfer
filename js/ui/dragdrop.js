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
            acceptedTypes: null,
            ...options
        };

        this.dragCounter = 0;
        this.init();
    }

    init() {
        if (!this.dropZone || !this.fileInput) {
            console.error('[DragDrop] Required elements not found');
            return;
        }

        // Click to select files
        this.dropZone.addEventListener('click', (e) => {
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
            e.target.value = '';
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
                        readEntries();
                    }, reject);
                };

                readEntries();
            }
        });
    }

    _processFiles(files, isFolder) {
        const errors = [];
        const validFiles = [];
        let totalSize = 0;

        for (const f of files) {
            if (f.file.size > this.options.maxFileSize) {
                errors.push(`${f.file.name} exceeds maximum size of ${formatSize(this.options.maxFileSize)}`);
                continue;
            }

            if (this.options.acceptedTypes && !this.options.acceptedTypes.includes(f.file.type)) {
                errors.push(`${f.file.name} is not an accepted file type`);
                continue;
            }

            validFiles.push(f);
            totalSize += f.file.size;
        }

        if (errors.length > 0) {
            this.options.onError(errors);
        }

        if (validFiles.length > 0) {
            state.set({
                selectedFiles: validFiles,
                isFolderTransfer: isFolder,
                totalSize
            });
            this.options.onFilesSelected(validFiles, isFolder, totalSize);
        }
    }

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
