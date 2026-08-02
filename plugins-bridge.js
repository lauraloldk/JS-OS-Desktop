(function() {
    'use strict';

    const EXTENSIONS_ENDPOINT = '/plugins/extensions';

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

        if (ext.kind === 'callback' && typeof ctx.onCallback === 'function') {
            ctx.onCallback(ext);
            return;
        }

        throw new Error(`Unsupported extension kind: ${ext.kind || 'unknown'}`);
    }

    if (window.parent === window) {
        window.JSOSPluginsHost = {
            getExtensions,
            executeExtension
        };

        window.JSOSPlugins = window.JSOSPluginsHost;
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
        }
    };
})();
