(function() {
    'use strict';

    const EXTENSIONS_ENDPOINT = '/plugins/extensions';
    const EXECUTE_ENDPOINT = '/plugins/execute';
    const MENU_ATTR = 'data-jsos-plugin-menu-initialized';
    const BUTTON_ATTR = 'data-jsos-plugin-button-initialized';

    async function getExtensions(target, payload) {
        const query = new URLSearchParams({
            target: String(target || ''),
            payload: JSON.stringify(payload || {})
        });

        const response = await fetch(`${EXTENSIONS_ENDPOINT}?${query.toString()}`, {
            cache: 'no-store'
        });

        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.error || `Extensions request failed (${response.status})`);
        }

        return Array.isArray(data.extensions) ? data.extensions : [];
    }

    async function executePluginAction(actionId, payload) {
        const response = await fetch(EXECUTE_ENDPOINT, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                actionId: String(actionId || ''),
                payload: payload || {}
            })
        });

        const data = await response.json();
        if (!response.ok || data.status === 'error') {
            throw new Error(data.message || data.error || `Plugin action failed (${response.status})`);
        }

        return data;
    }

    function getWindowApi() {
        if (window.parent && window.parent !== window) {
            return window.parent;
        }
        return window;
    }

    function executeExtension(extension, context) {
        const ext = extension || {};
        const ctx = context || {};
        const host = getWindowApi();

        if (ext.kind === 'quick-action' || ext.kind === 'open-app') {
            if (typeof host.createWindow === 'function' && ext.appUrl) {
                host.createWindow(ext.label || ext.id || 'Plugin App', ext.appUrl);
                return;
            }
        }

        if (ext.kind === 'open-url' && ext.url) {
            window.open(ext.url, '_blank', 'noopener');
            return;
        }

        if (ext.kind === 'plugin-action' && ext.actionId) {
            return executePluginAction(ext.actionId, {
                ...(ctx.payload || {}),
                appId: ctx.appId || '',
                sourceTarget: ctx.target || ''
            });
        }

        if (ext.kind === 'callback' && typeof ctx.onCallback === 'function') {
            ctx.onCallback(ext);
            return;
        }

        throw new Error(`Unsupported extension kind: ${ext.kind || 'unknown'}`);
    }

    function inferAppId(targetWindow) {
        try {
            const path = String((targetWindow.location && targetWindow.location.pathname) || '').toLowerCase();
            const appMatch = path.match(/\/apps\/([^\/]+)\//);
            if (appMatch && appMatch[1]) {
                return appMatch[1];
            }

            const settingsMatch = path.match(/\/settings\/([^\/]+)\//);
            if (settingsMatch && settingsMatch[1]) {
                return `settings.${settingsMatch[1]}`;
            }

            if (path.endsWith('/settings/index.html')) {
                return 'settings';
            }

            if (path.endsWith('/index.html') || path === '/' || path === '') {
                return 'desktop';
            }
        } catch (error) {
            return '';
        }

        return '';
    }

    function ensureMenuHost(doc) {
        let host = doc.getElementById('jsosPluginActionsMenu');
        if (host) {
            return host;
        }

        host = doc.createElement('div');
        host.id = 'jsosPluginActionsMenu';
        host.style.position = 'fixed';
        host.style.minWidth = '190px';
        host.style.background = '#fff';
        host.style.border = '1px solid #c5d3e2';
        host.style.borderRadius = '8px';
        host.style.boxShadow = '0 10px 24px rgba(0, 0, 0, 0.18)';
        host.style.padding = '6px';
        host.style.display = 'none';
        host.style.zIndex = '99999';

        doc.body.appendChild(host);

        if (!doc.body.getAttribute(MENU_ATTR)) {
            doc.body.setAttribute(MENU_ATTR, '1');
            doc.addEventListener('click', function() {
                host.style.display = 'none';
            });
        }

        return host;
    }

    function getJsexplorerPayload(targetWindow) {
        const doc = targetWindow.document;
        const pathInput = doc.getElementById('pathInput');
        const currentPath = pathInput ? String(pathInput.value || '').replace(/^\/+/, '') : '';

        const active = doc.querySelector('.entry.active');
        const activeNameNode = active ? active.querySelector('.entry-name') : null;
        const activeMetaNode = active ? active.querySelector('.entry-meta') : null;
        const selectedName = activeNameNode ? String(activeNameNode.textContent || '').trim() : '';
        const selectedType = activeMetaNode ? String(activeMetaNode.textContent || '').trim().toLowerCase() : '';

        let selectedPath = '';
        if (selectedName) {
            selectedPath = [currentPath, selectedName].filter(Boolean).join('/');
        }

        return {
            currentPath,
            selectedName,
            selectedType,
            selectedPath
        };
    }

    function getNotepadPayload(targetWindow) {
        const doc = targetWindow.document;
        const pathInput = doc.getElementById('pathInput');
        const editor = doc.getElementById('editor');

        const currentPathRaw = pathInput ? String(pathInput.value || '').trim() : '';
        const content = editor ? String(editor.value || '') : '';

        const isSavedFile = !!currentPathRaw &&
            currentPathRaw.toLowerCase() !== 'unsaved file' &&
            !currentPathRaw.toLowerCase().startsWith('notepad - ');

        return {
            currentPath: isSavedFile ? currentPathRaw.replace(/^\/+/, '') : '',
            content,
            isSavedFile
        };
    }

    function collectPayloadForApp(targetWindow, appId) {
        if (appId === 'jsexplorer') {
            return getJsexplorerPayload(targetWindow);
        }

        if (appId === 'notepad') {
            return getNotepadPayload(targetWindow);
        }

        return {};
    }

    async function openPluginMenu(targetWindow, triggerButton) {
        const doc = targetWindow.document;
        const appId = inferAppId(targetWindow);
        const payload = collectPayloadForApp(targetWindow, appId);
        const target = `${appId}.plugin-menu`;

        const extensions = await getExtensions(target, payload);
        const menuItems = extensions.filter(function(item) {
            return item && (item.kind === 'plugin-action' || item.kind === 'open-app' || item.kind === 'quick-action' || item.kind === 'open-url');
        });

        const menu = ensureMenuHost(doc);
        menu.innerHTML = '';

        if (!menuItems.length) {
            const empty = doc.createElement('div');
            empty.textContent = 'No plugin actions';
            empty.style.padding = '8px 10px';
            empty.style.fontSize = '12px';
            empty.style.color = '#65778b';
            menu.appendChild(empty);
        } else {
            menuItems.forEach(function(item) {
                const button = doc.createElement('button');
                button.type = 'button';
                button.textContent = item.label || item.id || 'Plugin Action';
                button.style.width = '100%';
                button.style.textAlign = 'left';
                button.style.border = '0';
                button.style.background = 'transparent';
                button.style.padding = '8px 10px';
                button.style.borderRadius = '6px';
                button.style.cursor = 'pointer';
                button.addEventListener('mouseenter', function() {
                    button.style.background = '#eef5ff';
                });
                button.addEventListener('mouseleave', function() {
                    button.style.background = 'transparent';
                });
                button.addEventListener('click', async function(event) {
                    event.stopPropagation();
                    try {
                        const actionPayload = { ...payload };
                        if (item.kind === 'plugin-action' && item.actionId === 'zip.add_password') {
                            const input = targetWindow.prompt('ZIP password');
                            if (input === null) {
                                return;
                            }
                            actionPayload.password = String(input);
                        }

                        const result = await executeExtension(item, {
                            appId,
                            target,
                            payload: actionPayload,
                            sourceWindow: targetWindow
                        });

                        if (result && result.message) {
                            targetWindow.alert(result.message);
                        }

                        if (appId === 'jsexplorer' && typeof targetWindow.loadListing === 'function') {
                            targetWindow.loadListing(payload.currentPath || '').catch(function() {
                                // Ignore refresh errors in plugin action callback.
                            });
                        }
                    } catch (error) {
                        alert(error.message);
                    }
                    menu.style.display = 'none';
                });
                menu.appendChild(button);
            });
        }

        const rect = triggerButton.getBoundingClientRect();
        menu.style.left = `${Math.max(8, rect.left)}px`;
        menu.style.top = `${Math.max(8, rect.bottom + 6)}px`;
        menu.style.display = 'block';
    }

    function buildToolbarButton(targetWindow, toolbar, descriptor) {
        const doc = targetWindow.document;
        const button = doc.createElement('button');
        button.type = 'button';
        button.textContent = descriptor.label || 'Plugin Actions';
        button.className = 'jsos-plugin-actions-button';
        button.setAttribute(BUTTON_ATTR, '1');
        button.style.whiteSpace = 'nowrap';

        button.addEventListener('click', function(event) {
            event.stopPropagation();
            openPluginMenu(targetWindow, button).catch(function(error) {
                alert(error.message);
            });
        });

        toolbar.appendChild(button);
    }

    async function ensureToolbarButtons(targetWindow) {
        const doc = targetWindow.document;
        if (!doc || !doc.body) {
            return;
        }

        const descriptors = await getExtensions('toolbar.inject', {
            appId: inferAppId(targetWindow)
        });

        const buttonDescriptor = descriptors.find(function(item) {
            return item && item.kind === 'toolbar-button' && item.id === 'core.plugins_actions';
        });

        if (!buttonDescriptor) {
            return;
        }

        doc.querySelectorAll('.toolbar').forEach(function(toolbar) {
            if (!toolbar || toolbar.querySelector(`[${BUTTON_ATTR}]`)) {
                return;
            }
            buildToolbarButton(targetWindow, toolbar, buttonDescriptor);
        });
    }

    function installAutoToolbarBridge(targetWindow) {
        const run = function() {
            ensureToolbarButtons(targetWindow).catch(function() {
                // Keep app usable even if plugin metadata fails.
            });
        };

        if (targetWindow.document && targetWindow.document.readyState === 'loading') {
            targetWindow.document.addEventListener('DOMContentLoaded', run);
        } else {
            run();
        }

        targetWindow.setInterval(run, 2500);
    }

    if (window.parent === window) {
        window.JSOSPluginsHost = {
            getExtensions,
            executeExtension,
            installAutoToolbarBridge
        };

        window.JSOSPlugins = window.JSOSPluginsHost;
        installAutoToolbarBridge(window);
        return;
    }

    window.JSOSPlugins = {
        getExtensions: function(target, payload) {
            if (!window.parent.JSOSPluginsHost) {
                return Promise.resolve([]);
            }
            return window.parent.JSOSPluginsHost.getExtensions(target, payload || {});
        },
        executeExtension: function(extension, context) {
            if (!window.parent.JSOSPluginsHost) {
                throw new Error('Plugin host is not available');
            }
            return window.parent.JSOSPluginsHost.executeExtension(extension, context || {});
        },
        installAutoToolbarBridge: function(targetWindow) {
            if (!window.parent.JSOSPluginsHost || typeof window.parent.JSOSPluginsHost.installAutoToolbarBridge !== 'function') {
                return;
            }
            window.parent.JSOSPluginsHost.installAutoToolbarBridge(targetWindow || window);
        }
    };

    window.JSOSPlugins.installAutoToolbarBridge(window);
})();
