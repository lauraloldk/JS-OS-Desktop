(function() {
    'use strict';

    const windowsById = new Map();
    let windowIdCounter = 0;
    let zIndexCounter = 20;

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

    window.createWindow = function(title, url) {
        const canvas = document.getElementById('canvas');
        if (!canvas) {
            throw new Error('Canvas element not found');
        }

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
        const helpButton = windowDiv.querySelector('.help');
        const shortcutButton = windowDiv.querySelector('.add-shortcut');

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

            function handleMouseMove(moveEvent) {
                const deltaX = moveEvent.clientX - initialMouseX;
                const deltaY = moveEvent.clientY - initialMouseY;
                const newWindowX = initialWindowX + deltaX;
                const newWindowY = initialWindowY + deltaY;
                windowDiv.style.left = `${newWindowX}px`;
                windowDiv.style.top = `${newWindowY}px`;
            }

            function handleMouseUp() {
                window.removeEventListener('mousemove', handleMouseMove);
                window.removeEventListener('mouseup', handleMouseUp);
            }

            window.addEventListener('mousemove', handleMouseMove);
            window.addEventListener('mouseup', handleMouseUp);
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

            function handleResize(moveEvent) {
                const newWidth = Math.max(minWidth, startWidth + (moveEvent.clientX - startX));
                const newHeight = Math.max(minHeight, startHeight + (moveEvent.clientY - startY));
                windowDiv.style.width = `${newWidth}px`;
                windowDiv.style.height = `${newHeight}px`;
            }

            function stopResize() {
                window.removeEventListener('mousemove', handleResize);
                window.removeEventListener('mouseup', stopResize);
            }

            window.addEventListener('mousemove', handleResize);
            window.addEventListener('mouseup', stopResize);
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

        canvas.appendChild(windowDiv);
        focusWindowById(windowId);
        emitWindowEvent('jsos-window-created', getWindowState(meta));
    };
})();
