(function() {
    'use strict';

    const WINDOW_SETTINGS_PATH = 'data/window-settings.json';
    const SETTINGS_READ_ENDPOINT = '/settings/read';
    const SETTINGS_SAVE_ENDPOINT = '/settings/save';

    const windowsById = new Map();
    let windowIdCounter = 0;
    let zIndexCounter = 20;

    let windowSettingsDocument = null;
    let windowSettingsLoadPromise = null;

    function ensureInteractionOverlay() {
        let overlay = document.getElementById('jsos-interaction-overlay');
        if (overlay) {
            return overlay;
        }

        overlay = document.createElement('div');
        overlay.id = 'jsos-interaction-overlay';
        overlay.style.position = 'fixed';
        overlay.style.left = '0';
        overlay.style.top = '0';
        overlay.style.width = '100vw';
        overlay.style.height = '100vh';
        overlay.style.display = 'none';
        overlay.style.background = 'transparent';
        overlay.style.zIndex = '999999';
        document.body.appendChild(overlay);
        return overlay;
    }

    function startMouseInteraction(options) {
        const config = options || {};
        const overlay = ensureInteractionOverlay();
        const blockers = Array.isArray(config.blockers) ? config.blockers : [];
        const previousPointerEvents = new Map();
        const previousCursor = document.body.style.cursor;
        const previousUserSelect = document.body.style.userSelect;

        overlay.style.display = 'block';
        overlay.style.cursor = config.cursor || 'default';
        document.body.style.cursor = config.cursor || 'default';
        document.body.style.userSelect = 'none';

        blockers.forEach(function(node) {
            if (!node || !node.style) {
                return;
            }
            previousPointerEvents.set(node, node.style.pointerEvents);
            node.style.pointerEvents = 'none';
        });

        function cleanup() {
            document.removeEventListener('mousemove', handleMouseMove, true);
            document.removeEventListener('mouseup', handleMouseUp, true);
            window.removeEventListener('blur', handleWindowBlur);

            overlay.style.display = 'none';
            overlay.style.cursor = 'default';
            document.body.style.cursor = previousCursor;
            document.body.style.userSelect = previousUserSelect;

            blockers.forEach(function(node) {
                if (!node || !node.style) {
                    return;
                }
                node.style.pointerEvents = previousPointerEvents.get(node) || '';
            });

            if (typeof config.onStop === 'function') {
                config.onStop();
            }
        }

        function handleMouseMove(event) {
            if ((event.buttons & 1) !== 1) {
                cleanup();
                return;
            }

            if (typeof config.onMove === 'function') {
                config.onMove(event);
            }
        }

        function handleMouseUp() {
            cleanup();
        }

        function handleWindowBlur() {
            cleanup();
        }

        document.addEventListener('mousemove', handleMouseMove, true);
        document.addEventListener('mouseup', handleMouseUp, true);
        window.addEventListener('blur', handleWindowBlur);
    }

    function emitWindowEvent(name, state) {
        document.dispatchEvent(new CustomEvent(name, {
            detail: { ...state }
        }));
    }

    function getWindowState(meta) {
        return {
            id: meta.id,
            title: meta.title,
            url: meta.url,
            minimized: meta.minimized,
            active: meta.active
        };
    }

    function notifyWindowUpdated(meta) {
        emitWindowEvent('jsos-window-updated', getWindowState(meta));
    }

    function createDefaultWindowSettingsDocument() {
        return {
            settings: {
                windowSizes: {}
            },
            settingsMeta: {
                windowSizes: {
                    label: 'Window Sizes',
                    type: 'json',
                    category: 'Windows',
                    subcategory: 'Sizes',
                    description: 'Saved default window sizes per app or window URL.'
                }
            }
        };
    }

    function getWindowSettingsDoc() {
        if (!windowSettingsDocument || typeof windowSettingsDocument !== 'object' || Array.isArray(windowSettingsDocument)) {
            windowSettingsDocument = createDefaultWindowSettingsDocument();
        }

        if (!windowSettingsDocument.settings || typeof windowSettingsDocument.settings !== 'object' || Array.isArray(windowSettingsDocument.settings)) {
            windowSettingsDocument.settings = {};
        }

        if (!windowSettingsDocument.settings.windowSizes || typeof windowSettingsDocument.settings.windowSizes !== 'object' || Array.isArray(windowSettingsDocument.settings.windowSizes)) {
            windowSettingsDocument.settings.windowSizes = {};
        }

        return windowSettingsDocument;
    }

    function getWindowSizeKey(title, url) {
        const normalizedUrl = String(url || '').trim().replace(/\\/g, '/').toLowerCase();
        if (normalizedUrl) {
            return normalizedUrl.split('?')[0];
        }

        return `title:${String(title || '').trim().toLowerCase()}`;
    }

    function getSavedWindowSize(title, url) {
        const doc = getWindowSettingsDoc();
        const key = getWindowSizeKey(title, url);
        return doc.settings.windowSizes[key] || null;
    }

    function applySavedWindowSize(windowDiv, title, url) {
        const saved = getSavedWindowSize(title, url);
        if (!saved || typeof saved !== 'object') {
            return;
        }

        const width = Number(saved.width);
        const height = Number(saved.height);

        if (Number.isFinite(width) && width >= 320) {
            windowDiv.style.width = `${Math.round(width)}px`;
        }

        if (Number.isFinite(height) && height >= 220) {
            windowDiv.style.height = `${Math.round(height)}px`;
        }
    }

    async function ensureWindowSettingsLoaded() {
        if (windowSettingsLoadPromise) {
            return windowSettingsLoadPromise;
        }

        windowSettingsLoadPromise = (async function() {
            try {
                const response = await fetch(`${SETTINGS_READ_ENDPOINT}?path=${encodeURIComponent(WINDOW_SETTINGS_PATH)}`, {
                    cache: 'no-store'
                });

                if (!response.ok) {
                    windowSettingsDocument = createDefaultWindowSettingsDocument();
                    return;
                }

                const payload = await response.json();
                windowSettingsDocument = payload.data;
                getWindowSettingsDoc();
            } catch (error) {
                console.error('Failed to load window settings:', error);
                windowSettingsDocument = createDefaultWindowSettingsDocument();
            }
        })();

        return windowSettingsLoadPromise;
    }

    async function saveWindowSettingsDocument() {
        const doc = getWindowSettingsDoc();
        const response = await fetch(SETTINGS_SAVE_ENDPOINT, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                path: WINDOW_SETTINGS_PATH,
                data: doc
            })
        });

        const payload = await response.json();
        if (!response.ok || payload.status !== 'success') {
            throw new Error(payload.message || `Failed to save window settings (${response.status})`);
        }
    }

    async function setDefaultSizeForWindow(meta) {
        if (!meta || !meta.windowDiv) {
            return;
        }

        await ensureWindowSettingsLoaded();

        const width = Math.max(320, meta.windowDiv.offsetWidth || 0);
        const height = Math.max(220, meta.windowDiv.offsetHeight || 0);
        const key = getWindowSizeKey(meta.title, meta.url);

        const doc = getWindowSettingsDoc();
        doc.settings.windowSizes[key] = {
            width: Math.round(width),
            height: Math.round(height)
        };

        await saveWindowSettingsDocument();
    }

    function bootstrapPluginsInIframe(iframeElement) {
        if (!iframeElement) {
            return;
        }

        try {
            const frameWindow = iframeElement.contentWindow;
            const frameDocument = iframeElement.contentDocument;
            if (!frameWindow || !frameDocument) {
                return;
            }

            function startToolbarBridge() {
                try {
                    if (frameWindow.JSOSPlugins && typeof frameWindow.JSOSPlugins.installAutoToolbarBridge === 'function') {
                        frameWindow.JSOSPlugins.installAutoToolbarBridge(frameWindow);
                    }
                } catch (error) {
                    // Keep app usable if plugin bridge cannot initialize.
                }
            }

            if (frameWindow.JSOSPlugins && typeof frameWindow.JSOSPlugins.installAutoToolbarBridge === 'function') {
                startToolbarBridge();
                return;
            }

            const existingScript = frameDocument.querySelector('script[data-jsos-plugins-bridge="1"]');
            if (existingScript) {
                existingScript.addEventListener('load', startToolbarBridge, { once: true });
                return;
            }

            const script = frameDocument.createElement('script');
            script.src = '/plugins-bridge.js';
            script.dataset.jsosPluginsBridge = '1';
            script.addEventListener('load', startToolbarBridge, { once: true });

            if (frameDocument.head) {
                frameDocument.head.appendChild(script);
            } else if (frameDocument.documentElement) {
                frameDocument.documentElement.appendChild(script);
            }
        } catch (error) {
            // Ignore cross-frame bootstrap issues.
        }
    }

    function setWindowActive(meta, active) {
        meta.active = !!active;
        if (meta.windowDiv) {
            if (meta.active) {
                meta.windowDiv.classList.add('window-active');
            } else {
                meta.windowDiv.classList.remove('window-active');
            }
        }
    }

    function focusWindowById(windowId) {
        const target = windowsById.get(windowId);
        if (!target || !target.windowDiv) {
            return;
        }

        windowsById.forEach(function(meta) {
            setWindowActive(meta, false);
            notifyWindowUpdated(meta);
        });

        if (target.minimized) {
            target.minimized = false;
            target.windowDiv.style.display = '';
        }

        target.windowDiv.style.zIndex = String(++zIndexCounter);
        setWindowActive(target, true);
        notifyWindowUpdated(target);
    }

    function minimizeWindowById(windowId) {
        const target = windowsById.get(windowId);
        if (!target || !target.windowDiv || target.minimized) {
            return;
        }

        target.minimized = true;
        target.active = false;
        target.windowDiv.style.display = 'none';
        notifyWindowUpdated(target);
    }

    function restoreWindowById(windowId) {
        const target = windowsById.get(windowId);
        if (!target || !target.windowDiv) {
            return;
        }

        if (target.minimized) {
            target.minimized = false;
            target.windowDiv.style.display = '';
        }

        focusWindowById(windowId);
    }

    function toggleMinimizeById(windowId) {
        const target = windowsById.get(windowId);
        if (!target) {
            return;
        }

        if (target.minimized) {
            restoreWindowById(windowId);
            return;
        }

        if (target.active) {
            minimizeWindowById(windowId);
            return;
        }

        focusWindowById(windowId);
    }

    function updateWindowTitleById(windowId, title) {
        const target = windowsById.get(windowId);
        if (!target || !target.windowDiv) {
            return;
        }

        const normalizedTitle = String(title || '').trim() || target.title;
        target.title = normalizedTitle;
        target.windowDiv.dataset.windowTitle = normalizedTitle;

        const titleElement = target.windowDiv.querySelector('.window-title');
        if (titleElement) {
            titleElement.textContent = normalizedTitle;
        }

        notifyWindowUpdated(target);
    }

    window.JSOSWindows = {
        list: function() {
            return Array.from(windowsById.values()).map(function(meta) {
                return getWindowState(meta);
            });
        },
        focusWindow: focusWindowById,
        minimizeWindow: minimizeWindowById,
        restoreWindow: restoreWindowById,
        toggleMinimize: toggleMinimizeById,
        updateTitle: updateWindowTitleById
    };

    ensureWindowSettingsLoaded().catch(function(error) {
        console.error('Failed to initialize window settings:', error);
    });

    window.createWindow = function(title, url) {
        const canvas = document.getElementById('canvas');
        if (!canvas) {
            throw new Error('Canvas element not found');
        }

        ensureWindowSettingsLoaded().catch(function(error) {
            console.error('Window settings not ready:', error);
        });

        const windowId = `window-${++windowIdCounter}`;
        const windowDiv = document.createElement('div');
        windowDiv.classList.add('window');
        windowDiv.dataset.windowId = windowId;
        windowDiv.dataset.windowTitle = title;
        windowDiv.dataset.windowUrl = url;
        windowDiv.innerHTML = `
            <div class="window-header">
                <span class="window-title">${title}</span>
                <div class="window-controls">
                    <button class="add-shortcut" title="Add to desktop">Add Shortcut</button>
                    <button class="window-set-default-size" title="Set default size for this app/window">Set Size</button>
                    <button class="window-minimize" title="Minimize">_</button>
                    <button class="help" title="Help">?</button>
                    <button class="window-close" title="Close">X</button>
                </div>
            </div>
            <iframe class="window-content" src="${url}"></iframe>
            <div class="window-resizer" title="Resize"></div>
        `;

        const meta = {
            id: windowId,
            title: title,
            url: url,
            minimized: false,
            active: false,
            windowDiv: windowDiv
        };

        windowsById.set(windowId, meta);

        const windowHeader = windowDiv.querySelector('.window-header');
        const windowContent = windowDiv.querySelector('.window-content');
        const windowResizer = windowDiv.querySelector('.window-resizer');
        const windowCloseButton = windowDiv.querySelector('.window-close');
        const windowMinimizeButton = windowDiv.querySelector('.window-minimize');
        const setDefaultSizeButton = windowDiv.querySelector('.window-set-default-size');
        const helpButton = windowDiv.querySelector('.help');
        const shortcutButton = windowDiv.querySelector('.add-shortcut');

        applySavedWindowSize(windowDiv, title, url);
        if (windowSettingsLoadPromise) {
            windowSettingsLoadPromise.then(function() {
                applySavedWindowSize(windowDiv, title, url);
            }).catch(function() {
                // Keep default size when settings are unavailable.
            });
        }

        windowDiv.addEventListener('mousedown', function() {
            focusWindowById(windowId);
        });

        windowContent.addEventListener('mousedown', function() {
            focusWindowById(windowId);
        });

        let initialMouseX = 0;
        let initialMouseY = 0;
        let initialWindowX = 0;
        let initialWindowY = 0;

        windowHeader.addEventListener('mousedown', function(event) {
            if (event.target.tagName === 'BUTTON') {
                return;
            }

            if (meta.minimized) {
                return;
            }

            focusWindowById(windowId);

            initialMouseX = event.clientX;
            initialMouseY = event.clientY;
            const windowRect = windowDiv.getBoundingClientRect();
            initialWindowX = windowRect.left;
            initialWindowY = windowRect.top;

            startMouseInteraction({
                cursor: 'move',
                blockers: [windowContent],
                onMove: function(moveEvent) {
                    const deltaX = moveEvent.clientX - initialMouseX;
                    const deltaY = moveEvent.clientY - initialMouseY;
                    const newWindowX = initialWindowX + deltaX;
                    const newWindowY = initialWindowY + deltaY;
                    windowDiv.style.left = `${newWindowX}px`;
                    windowDiv.style.top = `${newWindowY}px`;
                }
            });

            event.preventDefault();
        });

        windowResizer.addEventListener('mousedown', function(event) {
            if (meta.minimized) {
                return;
            }

            focusWindowById(windowId);

            const startWidth = windowDiv.offsetWidth;
            const startHeight = windowDiv.offsetHeight;
            const startX = event.clientX;
            const startY = event.clientY;
            const minWidth = 320;
            const minHeight = 220;

            startMouseInteraction({
                cursor: 'nwse-resize',
                blockers: [windowContent],
                onMove: function(moveEvent) {
                    const newWidth = Math.max(minWidth, startWidth + (moveEvent.clientX - startX));
                    const newHeight = Math.max(minHeight, startHeight + (moveEvent.clientY - startY));
                    windowDiv.style.width = `${newWidth}px`;
                    windowDiv.style.height = `${newHeight}px`;
                }
            });

            event.preventDefault();
            event.stopPropagation();
        });

        windowCloseButton.addEventListener('click', function() {
            windowsById.delete(windowId);
            if (windowDiv.parentNode === canvas) {
                canvas.removeChild(windowDiv);
            }
            emitWindowEvent('jsos-window-closed', { id: windowId });
        });

        windowMinimizeButton.addEventListener('click', function() {
            toggleMinimizeById(windowId);
        });

        setDefaultSizeButton.addEventListener('click', async function() {
            try {
                await setDefaultSizeForWindow(meta);
                alert(`Default size saved for ${meta.title}.`);
            } catch (error) {
                console.error('Failed to save default window size:', error);
                alert(error.message || 'Could not save default size.');
            }
        });

        helpButton.addEventListener('click', function() {
            const helpUrl = url.replace(/\/[^/]*$/, '/help.html');
            createWindow('Help', helpUrl);
        });

        const shortcutTarget = {
            title: title,
            url: url,
            type: url.startsWith('apps/') ? 'app' : 'file'
        };

        if (window.JSOSShortcuts && typeof window.JSOSShortcuts.syncButtonState === 'function') {
            window.JSOSShortcuts.syncButtonState(shortcutButton, shortcutTarget);
        }

        shortcutButton.addEventListener('click', async function() {
            if (!window.JSOSShortcuts || typeof window.JSOSShortcuts.toggleShortcutForTarget !== 'function') {
                alert('Shortcut system is not loaded yet.');
                return;
            }

            try {
                await window.JSOSShortcuts.toggleShortcutForTarget(shortcutTarget);
                window.JSOSShortcuts.syncButtonState(shortcutButton, shortcutTarget);
            } catch (error) {
                console.error('Failed to toggle shortcut:', error);
                alert('Could not update shortcut.');
            }
        });

        windowContent.style.backgroundColor = 'grey';
        windowContent.addEventListener('load', function() {
            bootstrapPluginsInIframe(windowContent);
        });

        canvas.appendChild(windowDiv);
        focusWindowById(windowId);
        emitWindowEvent('jsos-window-created', getWindowState(meta));
    };
})();
