(function() {
    'use strict';

    const registry = [];
    let openInProvider = null;

    function stripQuotes(value) {
        const text = String(value || '').trim();
        if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
            return text.slice(1, -1).trim();
        }
        return text;
    }

    function getOpenTarget() {
        if (window.parent && window.parent !== window && typeof window.parent.createWindow === 'function') {
            return window.parent;
        }

        if (typeof window.createWindow === 'function') {
            return window;
        }

        return null;
    }

    function normalizePath(pathValue) {
        return String(pathValue || '').replace(/\\/g, '/').trim().replace(/^\/+/, '');
    }

    async function requestJson(url, options) {
        const response = await fetch(url, options || {});
        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.error || data.message || `Request failed (${response.status})`);
        }
        return data;
    }

    async function appExists(appName) {
        const safeName = String(appName || '').trim().toLowerCase();
        if (!safeName) {
            return false;
        }
        const response = await fetch(`apps/${safeName}/index.html`, { method: 'HEAD', cache: 'no-store' });
        return response.ok;
    }

    async function openApp(appName) {
        const opener = getOpenTarget();
        if (!opener) {
            throw new Error('Window system is not available in this context');
        }

        const name = String(appName || '').trim();
        if (!name) {
            throw new Error('Missing app name');
        }

        const exists = await appExists(name);
        if (!exists) {
            throw new Error(`App not found: ${name}`);
        }

        opener.createWindow(name, `apps/${name.toLowerCase()}/index.html`);
        return `Opened app ${name}`;
    }

    function openNotepadContent(contentText, titleText) {
        const opener = getOpenTarget();
        if (!opener) {
            throw new Error('Window system is not available in this context');
        }

        const content = String(contentText || '');
        const title = String(titleText || 'Notepad').trim() || 'Notepad';
        const query = new URLSearchParams({
            content: content,
            title: title
        });

        opener.createWindow(title, `apps/notepad/index.html?${query.toString()}`);
        return `Opened ${title}`;
    }

    function setOpenInProvider(provider) {
        if (provider === null) {
            openInProvider = null;
            return;
        }

        if (!provider || typeof provider.executeOpenIn !== 'function') {
            throw new Error('Open-in provider must expose executeOpenIn(filePath, appName)');
        }

        openInProvider = provider;
    }

    async function executeOpenIn(filePath, appName) {
        if (!openInProvider || typeof openInProvider.executeOpenIn !== 'function') {
            throw new Error('Open-in command provider is not available');
        }

        return openInProvider.executeOpenIn(filePath, appName);
    }

    function register(definition) {
        if (!definition || typeof definition !== 'object') {
            throw new Error('Command definition must be an object');
        }
        if (!definition.id || typeof definition.id !== 'string') {
            throw new Error('Command definition requires id');
        }
        if (typeof definition.match !== 'function' || typeof definition.run !== 'function') {
            throw new Error(`Command ${definition.id} must define match() and run()`);
        }
        registry.push(definition);
    }

    function getCommands() {
        return registry.map(function(command) {
            return {
                id: command.id,
                usage: command.usage || command.id,
                description: command.description || ''
            };
        });
    }

    register({
        id: 'core.help',
        usage: 'help',
        description: 'Show all available commands',
        match: function(input) {
            return /^help$/i.test(input) ? {} : null;
        },
        run: function() {
            const lines = getCommands().map(function(command) {
                return `${command.usage} - ${command.description}`;
            });

            const content = [
                'JS-OS Command Help',
                '====================',
                '',
                ...lines
            ].join('\n');

            return openNotepadContent(content, 'Notepad - Command Help');
        }
    });

    async function execute(commandText) {
        const command = String(commandText || '').trim();
        if (!command) {
            throw new Error('Command is empty');
        }

        for (const definition of registry) {
            const match = definition.match(command);
            if (match !== null && match !== undefined) {
                return definition.run(match, {
                    openApp,
                    executeOpenIn,
                    requestJson,
                    getOpenTarget,
                    stripQuotes,
                    normalizePath
                });
            }
        }

        throw new Error(`Unknown command: ${command}`);
    }

    window.JSOSCmd = {
        register,
        getCommands,
        openApp,
        openNotepadContent,
        executeOpenIn,
        setOpenInProvider,
        requestJson,
        getOpenTarget,
        stripQuotes,
        normalizePath,
        execute
    };
})();
