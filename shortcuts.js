(function() {
    'use strict';

    const SHORTCUTS_PATH = 'data/shortcuts.json';
    const SHORTCUT_ICON = 'icons/unknown-file-icon.png';
    const ACTIONS_LIST_ENDPOINT = '/actions/list';
    const ACTIONS_EXECUTE_ENDPOINT = '/actions/execute';

    let shortcuts = [];
    let canvas = null;
    let contextMenu = null;

    function getCanvas() {
        if (!canvas) {
            canvas = document.getElementById('canvas');
        }
        return canvas;
    }

    function normalizeValue(value) {
        return String(value || '').trim();
    }

    function targetKey(target) {
        return `${normalizeValue(target.title)}::${normalizeValue(target.url)}`.toLowerCase();
    }

    function findShortcutIndex(target) {
        const key = targetKey(target);
        return shortcuts.findIndex(function(item) {
            return targetKey(item) === key;
        });
    }

    function hasShortcutForTarget(target) {
        return findShortcutIndex(target) !== -1;
    }

    function getDefaultPosition(index) {
        const col = index % 6;
        const row = Math.floor(index / 6);
        return {
            x: 20 + col * 90,
            y: 20 + row * 100
        };
    }

    async function loadShortcuts() {
        try {
            const response = await fetch(SHORTCUTS_PATH, { cache: 'no-store' });
            if (!response.ok) {
                shortcuts = [];
                return;
            }

            const payload = await response.json();
            if (Array.isArray(payload.shortcuts)) {
                shortcuts = payload.shortcuts;
            } else {
                shortcuts = [];
            }
        } catch (error) {
            console.error('Failed to load shortcuts:', error);
            shortcuts = [];
        }
    }

    async function saveShortcuts() {
        const response = await fetch('/update-shortcuts', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ shortcuts: shortcuts })
        });

        if (!response.ok) {
            throw new Error(`Failed to save shortcuts (${response.status})`);
        }
    }

    function openShortcut(shortcut) {
        if (typeof window.createWindow === 'function') {
            window.createWindow(shortcut.title, shortcut.url);
        }
    }

    function ensureContextMenu() {
        if (contextMenu) {
            return contextMenu;
        }

        contextMenu = document.createElement('div');
        contextMenu.className = 'shortcut-context-menu hidden';
        document.body.appendChild(contextMenu);
        return contextMenu;
    }

    function hideContextMenu() {
        if (!contextMenu) {
            return;
        }
        contextMenu.classList.add('hidden');
        contextMenu.innerHTML = '';
    }

    async function listShortcutActions(shortcut) {
        const payload = encodeURIComponent(JSON.stringify({
            title: shortcut.title,
            url: shortcut.url,
            type: shortcut.type
        }));

        const response = await fetch(`${ACTIONS_LIST_ENDPOINT}?target=shortcut&payload=${payload}`, {
            cache: 'no-store'
        });

        if (!response.ok) {
            throw new Error(`Failed to load shortcut actions (${response.status})`);
        }

        const data = await response.json();
        return Array.isArray(data.actions) ? data.actions : [];
    }

    async function executeShortcutAction(actionId, shortcut) {
        const response = await fetch(ACTIONS_EXECUTE_ENDPOINT, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                target: 'shortcut',
                action: actionId,
                payload: {
                    title: shortcut.title,
                    url: shortcut.url,
                    type: shortcut.type
                }
            })
        });

        const result = await response.json();
        if (!response.ok || result.status !== 'success') {
            throw new Error(result.message || `Action failed (${response.status})`);
        }

        if (actionId === 'shortcut.remove') {
            const index = findShortcutIndex(shortcut);
            if (index !== -1) {
                shortcuts.splice(index, 1);
                renderShortcuts();
            }
        }
    }

    async function openShortcutContextMenu(event, shortcut) {
        event.preventDefault();

        const menu = ensureContextMenu();
        menu.innerHTML = '';

        try {
            const actions = await listShortcutActions(shortcut);

            if (!actions.length) {
                const emptyItem = document.createElement('div');
                emptyItem.className = 'shortcut-context-empty';
                emptyItem.textContent = 'Ingen handlinger';
                menu.appendChild(emptyItem);
            } else {
                actions.forEach(function(action) {
                    const button = document.createElement('button');
                    button.className = 'shortcut-context-item';
                    button.textContent = action.label || action.id;
                    button.addEventListener('click', async function() {
                        hideContextMenu();
                        try {
                            await executeShortcutAction(action.id, shortcut);
                        } catch (error) {
                            console.error('Shortcut action failed:', error);
                            alert(error.message);
                        }
                    });
                    menu.appendChild(button);
                });
            }
        } catch (error) {
            const errItem = document.createElement('div');
            errItem.className = 'shortcut-context-empty';
            errItem.textContent = `Fejl: ${error.message}`;
            menu.appendChild(errItem);
        }

        menu.style.left = `${event.clientX}px`;
        menu.style.top = `${event.clientY}px`;
        menu.classList.remove('hidden');
    }

    function clampPosition(x, y, element) {
        const targetCanvas = getCanvas();
        if (!targetCanvas) {
            return { x: Math.max(0, x), y: Math.max(0, y) };
        }

        const maxX = Math.max(0, targetCanvas.clientWidth - element.offsetWidth);
        const maxY = Math.max(0, targetCanvas.clientHeight - element.offsetHeight);

        return {
            x: Math.min(Math.max(0, x), maxX),
            y: Math.min(Math.max(0, y), maxY)
        };
    }

    function bindDrag(element, shortcut, index) {
        let isDragging = false;
        let startMouseX = 0;
        let startMouseY = 0;
        let startX = 0;
        let startY = 0;

        element.addEventListener('mousedown', function(event) {
            if (event.button !== 0) {
                return;
            }

            isDragging = true;
            startMouseX = event.clientX;
            startMouseY = event.clientY;
            startX = Number(shortcut.x) || 0;
            startY = Number(shortcut.y) || 0;

            event.preventDefault();
        });

        window.addEventListener('mousemove', function(event) {
            if (!isDragging) {
                return;
            }

            const deltaX = event.clientX - startMouseX;
            const deltaY = event.clientY - startMouseY;
            const rawX = startX + deltaX;
            const rawY = startY + deltaY;
            const bounded = clampPosition(rawX, rawY, element);

            element.style.left = `${bounded.x}px`;
            element.style.top = `${bounded.y}px`;
        });

        window.addEventListener('mouseup', async function() {
            if (!isDragging) {
                return;
            }

            isDragging = false;
            const x = parseInt(element.style.left, 10) || 0;
            const y = parseInt(element.style.top, 10) || 0;

            shortcuts[index].x = x;
            shortcuts[index].y = y;

            try {
                await saveShortcuts();
            } catch (error) {
                console.error('Failed to persist shortcut position:', error);
            }
        });
    }

    function createShortcutElement(shortcut, index) {
        const element = document.createElement('div');
        element.className = 'desktop-shortcut';
        element.title = `${shortcut.title}\n${shortcut.url}`;

        const x = Number(shortcut.x) || 0;
        const y = Number(shortcut.y) || 0;

        element.style.left = `${x}px`;
        element.style.top = `${y}px`;

        const icon = document.createElement('img');
        icon.className = 'desktop-shortcut-icon';
        icon.src = SHORTCUT_ICON;
        icon.alt = 'shortcut icon';

        const label = document.createElement('span');
        label.className = 'desktop-shortcut-label';
        label.textContent = shortcut.title;

        element.appendChild(icon);
        element.appendChild(label);

        element.addEventListener('dblclick', function() {
            openShortcut(shortcut);
        });

        element.addEventListener('contextmenu', function(event) {
            openShortcutContextMenu(event, shortcut);
        });

        bindDrag(element, shortcut, index);
        return element;
    }

    function clearRenderedShortcuts() {
        const targetCanvas = getCanvas();
        if (!targetCanvas) {
            return;
        }

        targetCanvas.querySelectorAll('.desktop-shortcut').forEach(function(node) {
            node.remove();
        });
    }

    function renderShortcuts() {
        const targetCanvas = getCanvas();
        if (!targetCanvas) {
            return;
        }

        clearRenderedShortcuts();

        shortcuts.forEach(function(shortcut, index) {
            const element = createShortcutElement(shortcut, index);
            targetCanvas.appendChild(element);
        });
    }

    async function addShortcut(target) {
        const item = {
            title: normalizeValue(target.title),
            url: normalizeValue(target.url),
            type: normalizeValue(target.type) || 'file'
        };

        if (!item.title || !item.url) {
            throw new Error('Shortcut target is missing title or url');
        }

        if (hasShortcutForTarget(item)) {
            return false;
        }

        const pos = getDefaultPosition(shortcuts.length);
        item.x = pos.x;
        item.y = pos.y;

        shortcuts.push(item);
        await saveShortcuts();
        renderShortcuts();
        return true;
    }

    async function removeShortcut(target) {
        const index = findShortcutIndex(target);
        if (index === -1) {
            return false;
        }

        shortcuts.splice(index, 1);
        await saveShortcuts();
        renderShortcuts();
        return true;
    }

    async function toggleShortcutForTarget(target) {
        if (hasShortcutForTarget(target)) {
            return removeShortcut(target);
        }
        return addShortcut(target);
    }

    function syncButtonState(button, target) {
        if (!button) {
            return;
        }

        const hasShortcut = hasShortcutForTarget(target);
        button.textContent = hasShortcut ? 'Remove Shortcut' : 'Add Shortcut';
        button.title = hasShortcut ? 'Remove from desktop' : 'Add to desktop';
    }

    function injectShortcutStyles() {
        const styleTag = document.createElement('style');
        styleTag.textContent = `
            .desktop-shortcut {
                position: absolute;
                width: 72px;
                padding: 6px 4px;
                border-radius: 6px;
                display: flex;
                flex-direction: column;
                align-items: center;
                gap: 4px;
                cursor: move;
                user-select: none;
                text-align: center;
            }

            .desktop-shortcut:hover {
                background: rgba(255, 255, 255, 0.25);
            }

            .desktop-shortcut-icon {
                width: 40px;
                height: 40px;
                object-fit: contain;
                pointer-events: none;
            }

            .desktop-shortcut-label {
                color: #111;
                font-size: 12px;
                line-height: 1.2;
                word-break: break-word;
                text-shadow: 0 1px 2px rgba(255, 255, 255, 0.9);
                pointer-events: none;
            }

            .shortcut-context-menu {
                position: fixed;
                min-width: 180px;
                background: #fff;
                border: 1px solid #aaa;
                border-radius: 8px;
                box-shadow: 0 8px 20px rgba(0, 0, 0, 0.25);
                padding: 8px;
                z-index: 1300;
            }

            .shortcut-context-menu.hidden {
                display: none;
            }

            .shortcut-context-item {
                width: 100%;
                text-align: left;
                border: 1px solid #ddd;
                border-radius: 6px;
                background: #fff;
                padding: 7px 10px;
                margin-bottom: 6px;
                cursor: pointer;
            }

            .shortcut-context-item:hover {
                background: #f3f3f3;
            }

            .shortcut-context-item:last-child {
                margin-bottom: 0;
            }

            .shortcut-context-empty {
                color: #666;
                font-size: 12px;
                padding: 4px 6px;
            }
        `;
        document.head.appendChild(styleTag);
    }

    async function initShortcuts() {
        injectShortcutStyles();
        ensureContextMenu();
        await loadShortcuts();
        renderShortcuts();

        document.addEventListener('click', function() {
            hideContextMenu();
        });

        document.addEventListener('contextmenu', function(event) {
            const menu = ensureContextMenu();
            if (menu.contains(event.target)) {
                return;
            }
            if (!event.target.closest('.desktop-shortcut')) {
                hideContextMenu();
            }
        });

        window.addEventListener('resize', hideContextMenu);
    }

    window.JSOSShortcuts = {
        init: initShortcuts,
        hasShortcutForTarget,
        toggleShortcutForTarget,
        syncButtonState,
        render: renderShortcuts
    };

    document.addEventListener('DOMContentLoaded', initShortcuts);
})();
