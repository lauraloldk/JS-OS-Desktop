(function() {
    'use strict';

    const LIST_ENDPOINT = '/fs/list';

    function isTopWindow() {
        return window.parent === window;
    }

    async function fetchDirectory(path) {
        const response = await fetch(`${LIST_ENDPOINT}?path=${encodeURIComponent(path || '')}`, {
            cache: 'no-store'
        });
        const payload = await response.json();
        if (!response.ok) {
            throw new Error(payload.error || `Failed to list directory (${response.status})`);
        }
        return payload;
    }

    function createHost() {
        let overlay = null;

        function ensureOverlay() {
            if (overlay) {
                return overlay;
            }

            overlay = document.createElement('div');
            overlay.className = 'jsos-dialog-overlay hidden';
            document.body.appendChild(overlay);
            return overlay;
        }

        function injectStyles() {
            const style = document.createElement('style');
            style.textContent = `
                .jsos-dialog-overlay {
                    position: fixed;
                    inset: 0;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    background: rgba(0, 0, 0, 0.35);
                    z-index: 2000;
                }

                .jsos-dialog-overlay.hidden {
                    display: none;
                }

                .jsos-dialog {
                    width: min(640px, 90vw);
                    max-height: 80vh;
                    display: flex;
                    flex-direction: column;
                    background: #ffffff;
                    border-radius: 12px;
                    box-shadow: 0 18px 40px rgba(0, 0, 0, 0.3);
                    overflow: hidden;
                }

                .jsos-dialog-header {
                    padding: 14px 16px;
                    font-weight: 700;
                    border-bottom: 1px solid #ddd;
                }

                .jsos-dialog-body {
                    padding: 14px 16px;
                    display: flex;
                    flex-direction: column;
                    gap: 12px;
                }

                .jsos-dialog-path,
                .jsos-dialog-input {
                    width: 100%;
                    box-sizing: border-box;
                    border: 1px solid #ccc;
                    border-radius: 8px;
                    padding: 8px 10px;
                }

                .jsos-dialog-list {
                    min-height: 220px;
                    max-height: 320px;
                    overflow: auto;
                    border: 1px solid #ddd;
                    border-radius: 8px;
                    background: #fafafa;
                }

                .jsos-dialog-item {
                    width: 100%;
                    border: none;
                    border-bottom: 1px solid #eee;
                    background: transparent;
                    text-align: left;
                    padding: 10px 12px;
                    cursor: pointer;
                }

                .jsos-dialog-item:hover,
                .jsos-dialog-item.active {
                    background: #e9f2ff;
                }

                .jsos-dialog-item:last-child {
                    border-bottom: none;
                }

                .jsos-dialog-actions {
                    display: flex;
                    justify-content: flex-end;
                    gap: 8px;
                    padding: 14px 16px;
                    border-top: 1px solid #ddd;
                    background: #f8f8f8;
                }

                .jsos-dialog-button {
                    border: 1px solid #c7c7c7;
                    border-radius: 8px;
                    background: #fff;
                    padding: 8px 12px;
                    cursor: pointer;
                }
            `;
            document.head.appendChild(style);
        }

        function closeDialog(result, resolve) {
            const host = ensureOverlay();
            host.classList.add('hidden');
            host.innerHTML = '';
            resolve(result);
        }

        async function showFileDialog(options) {
            const host = ensureOverlay();
            const mode = options.mode || 'open';
            let currentPath = options.path || '';
            let selectedPath = options.selectedPath || '';
            let fileName = options.fileName || '';

            return new Promise(function(resolve) {
                async function render() {
                    host.innerHTML = '';
                    host.classList.remove('hidden');

                    const dialog = document.createElement('div');
                    dialog.className = 'jsos-dialog';

                    const header = document.createElement('div');
                    header.className = 'jsos-dialog-header';
                    header.textContent = mode === 'save' ? 'Save File' : 'Open File';

                    const body = document.createElement('div');
                    body.className = 'jsos-dialog-body';

                    const pathInput = document.createElement('input');
                    pathInput.className = 'jsos-dialog-path';
                    pathInput.value = currentPath;
                    pathInput.readOnly = true;
                    body.appendChild(pathInput);

                    const list = document.createElement('div');
                    list.className = 'jsos-dialog-list';
                    body.appendChild(list);

                    let fileNameInput = null;
                    if (mode === 'save') {
                        fileNameInput = document.createElement('input');
                        fileNameInput.className = 'jsos-dialog-input';
                        fileNameInput.placeholder = 'File name';
                        fileNameInput.value = fileName;
                        body.appendChild(fileNameInput);
                    }

                    const actions = document.createElement('div');
                    actions.className = 'jsos-dialog-actions';

                    const cancelButton = document.createElement('button');
                    cancelButton.className = 'jsos-dialog-button';
                    cancelButton.textContent = 'Cancel';
                    cancelButton.addEventListener('click', function() {
                        closeDialog(null, resolve);
                    });

                    const confirmButton = document.createElement('button');
                    confirmButton.className = 'jsos-dialog-button';
                    confirmButton.textContent = mode === 'save' ? 'Save' : 'Open';
                    confirmButton.addEventListener('click', function() {
                        if (mode === 'save') {
                            const nextName = (fileNameInput.value || '').trim();
                            if (!nextName) {
                                alert('Please choose a file name.');
                                return;
                            }
                            const nextPath = [currentPath, nextName].filter(Boolean).join('/');
                            closeDialog({ path: nextPath }, resolve);
                            return;
                        }

                        if (!selectedPath) {
                            alert('Please select a file.');
                            return;
                        }
                        closeDialog({ path: selectedPath }, resolve);
                    });

                    actions.appendChild(cancelButton);
                    actions.appendChild(confirmButton);

                    dialog.appendChild(header);
                    dialog.appendChild(body);
                    dialog.appendChild(actions);
                    host.appendChild(dialog);

                    try {
                        const listing = await fetchDirectory(currentPath);

                        if (currentPath) {
                            const upButton = document.createElement('button');
                            upButton.className = 'jsos-dialog-item';
                            upButton.textContent = '..';
                            upButton.addEventListener('click', function() {
                                const parts = currentPath.split('/').filter(Boolean);
                                parts.pop();
                                currentPath = parts.join('/');
                                selectedPath = '';
                                render();
                            });
                            list.appendChild(upButton);
                        }

                        listing.entries.forEach(function(entry) {
                            const item = document.createElement('button');
                            item.className = 'jsos-dialog-item';
                            item.textContent = entry.type === 'directory' ? `[DIR] ${entry.name}` : entry.name;
                            if (selectedPath === entry.path) {
                                item.classList.add('active');
                            }

                            item.addEventListener('click', function() {
                                if (entry.type === 'directory') {
                                    currentPath = entry.path;
                                    selectedPath = '';
                                    render();
                                    return;
                                }

                                selectedPath = entry.path;
                                fileName = entry.name;
                                if (fileNameInput) {
                                    fileNameInput.value = entry.name;
                                }
                                render();
                            });

                            list.appendChild(item);
                        });
                    } catch (error) {
                        const item = document.createElement('div');
                        item.className = 'jsos-dialog-item';
                        item.textContent = error.message;
                        list.appendChild(item);
                    }
                }

                render();
            });
        }

        injectStyles();
        ensureOverlay();

        return {
            openFileDialog: function(options) {
                return showFileDialog({ ...(options || {}), mode: 'open' });
            },
            saveFileDialog: function(options) {
                return showFileDialog({ ...(options || {}), mode: 'save' });
            }
        };
    }

    if (isTopWindow()) {
        const host = createHost();
        window.JSOSDialogsHost = host;
        window.JSOSDialogs = host;
    } else {
        window.JSOSDialogs = {
            openFileDialog: function(options) {
                return window.parent.JSOSDialogsHost.openFileDialog(options || {});
            },
            saveFileDialog: function(options) {
                return window.parent.JSOSDialogsHost.saveFileDialog(options || {});
            }
        };
    }
})();
