(function() {
    'use strict';

    const START_MENU_ENDPOINT = '/start-menu-items';
    const EXIT_ENDPOINT = '/exit-js-os';

    let startMenu;
    let subMenu;
    let startButton;
    let startItems = [];

    function ensureMenus() {
        if (!startMenu) {
            startMenu = document.createElement('div');
            startMenu.id = 'startMenu';
            startMenu.className = 'start-menu hidden';
            document.body.appendChild(startMenu);
        }

        if (!subMenu) {
            subMenu = document.createElement('div');
            subMenu.id = 'startSubMenu';
            subMenu.className = 'start-submenu hidden';
            document.body.appendChild(subMenu);
        }
    }

    function injectStyles() {
        const style = document.createElement('style');
        style.textContent = `
            .start-menu,
            .start-submenu {
                position: fixed;
                background: #fafafa;
                border: 1px solid #bbb;
                border-radius: 10px;
                box-shadow: 0 10px 30px rgba(0, 0, 0, 0.25);
                padding: 10px;
                z-index: 1000;
            }

            .start-menu {
                left: 10px;
                bottom: 58px;
                width: 240px;
            }

            .start-submenu {
                width: 300px;
                max-height: 70vh;
                overflow-y: auto;
            }

            .start-menu.hidden,
            .start-submenu.hidden {
                display: none;
            }

            .start-menu-title,
            .start-submenu-title {
                font-weight: 700;
                font-size: 14px;
                margin: 4px 6px 8px;
            }

            .start-menu-item,
            .start-menu-exit,
            .start-submenu-item {
                width: 100%;
                border: 1px solid #d6d6d6;
                background: #fff;
                color: #111;
                border-radius: 8px;
                padding: 8px 10px;
                margin-bottom: 6px;
                text-align: left;
                cursor: pointer;
                font-size: 13px;
            }

            .start-menu-item:hover,
            .start-menu-exit:hover,
            .start-submenu-item:hover {
                background: #f0f0f0;
            }

            .start-menu-exit {
                margin-top: 12px;
                border-color: #d9b8b8;
                background: #fff4f4;
            }

            .start-menu-empty {
                font-size: 12px;
                color: #777;
                margin: 6px;
            }
        `;

        document.head.appendChild(style);
    }

    async function fetchStartItems() {
        const response = await fetch(START_MENU_ENDPOINT, { cache: 'no-store' });
        if (!response.ok) {
            throw new Error(`Failed to load start menu items (${response.status})`);
        }

        const payload = await response.json();
        startItems = Array.isArray(payload.items) ? payload.items : [];
    }

    function closeMenus() {
        ensureMenus();
        startMenu.classList.add('hidden');
        subMenu.classList.add('hidden');
        subMenu.innerHTML = '';
        if (startButton) {
            startButton.setAttribute('aria-expanded', 'false');
        }
    }

    function isOpen() {
        return startMenu && !startMenu.classList.contains('hidden');
    }

    function openSubMenu(type, title) {
        ensureMenus();

        const items = startItems.filter(function(item) {
            return item.type === type;
        });

        subMenu.innerHTML = '';

        const submenuTitle = document.createElement('div');
        submenuTitle.className = 'start-submenu-title';
        submenuTitle.textContent = title;
        subMenu.appendChild(submenuTitle);

        if (!items.length) {
            const empty = document.createElement('div');
            empty.className = 'start-menu-empty';
            empty.textContent = 'Ingen elementer fundet.';
            subMenu.appendChild(empty);
        } else {
            items.forEach(function(item) {
                const button = document.createElement('button');
                button.className = 'start-submenu-item';
                button.textContent = item.title;
                button.title = item.url;
                button.addEventListener('click', function() {
                    if (typeof window.createWindow === 'function') {
                        window.createWindow(item.title, item.url);
                    }
                    closeMenus();
                });
                subMenu.appendChild(button);
            });
        }

        const rect = startMenu.getBoundingClientRect();
        subMenu.style.left = `${rect.right + 8}px`;
        subMenu.style.bottom = `${window.innerHeight - rect.bottom}px`;
        subMenu.classList.remove('hidden');
    }

    function renderMainMenu(errorMessage) {
        ensureMenus();
        startMenu.innerHTML = '';

        const title = document.createElement('div');
        title.className = 'start-menu-title';
        title.textContent = 'JS-OS Start';
        startMenu.appendChild(title);

        if (errorMessage) {
            const errorDiv = document.createElement('div');
            errorDiv.className = 'start-menu-empty';
            errorDiv.textContent = errorMessage;
            startMenu.appendChild(errorDiv);
        }

        const appsButton = document.createElement('button');
        appsButton.className = 'start-menu-item';
        appsButton.textContent = 'Vis Apps';
        appsButton.addEventListener('click', function() {
            openSubMenu('app', 'Apps');
        });
        startMenu.appendChild(appsButton);

        const settingsButton = document.createElement('button');
        settingsButton.className = 'start-menu-item';
        settingsButton.textContent = 'Vis Indstillinger';
        settingsButton.addEventListener('click', function() {
            openSubMenu('settings', 'Indstillinger');
        });
        startMenu.appendChild(settingsButton);

        const exitButton = document.createElement('button');
        exitButton.className = 'start-menu-exit';
        exitButton.textContent = 'Exit JS-OS';
        exitButton.addEventListener('click', async function() {
            try {
                await fetch(EXIT_ENDPOINT, { method: 'POST' });
            } catch (error) {
                console.error('Exit request failed:', error);
            }
        });
        startMenu.appendChild(exitButton);
    }

    async function openMenus() {
        let errorMessage = '';
        try {
            await fetchStartItems();
        } catch (error) {
            errorMessage = `Kunne ikke hente startmenu: ${error.message}`;
            startItems = [];
        }

        renderMainMenu(errorMessage);
        startMenu.classList.remove('hidden');
        if (startButton) {
            startButton.setAttribute('aria-expanded', 'true');
        }
    }

    async function toggleMenus() {
        if (isOpen()) {
            closeMenus();
            return;
        }

        await openMenus();
    }

    function bindGlobalClose() {
        document.addEventListener('click', function(event) {
            if (!isOpen()) {
                return;
            }

            const inMain = startMenu.contains(event.target);
            const inSub = subMenu.contains(event.target);
            if (inMain || inSub || event.target === startButton) {
                return;
            }

            closeMenus();
        });

        document.addEventListener('keydown', function(event) {
            if (event.key === 'Escape') {
                closeMenus();
            }
        });

        window.addEventListener('resize', function() {
            if (isOpen()) {
                closeMenus();
            }
        });
    }

    function initTaskbar() {
        startButton = document.getElementById('startButton');
        if (!startButton) {
            return;
        }

        injectStyles();
        ensureMenus();

        startButton.textContent = 'Start';
        startButton.setAttribute('aria-expanded', 'false');
        startButton.addEventListener('click', function(event) {
            event.stopPropagation();
            toggleMenus();
        });

        bindGlobalClose();
    }

    document.addEventListener('DOMContentLoaded', initTaskbar);
})();
