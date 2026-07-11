(function() {
    'use strict';

    if (!window.JSOSCmd || typeof window.JSOSCmd.register !== 'function') {
        return;
    }

    window.JSOSCmd.register({
        id: 'open.in',
        usage: 'open <path> in <app>',
        description: 'Open a file or path in a specific app (notepad, jsexplorer)',
        match: function(input) {
            const match = input.match(/^open\s+(.+?)\s+in\s+([a-zA-Z0-9_-]+)$/i);
            return match ? { path: match[1], appName: match[2] } : null;
        },
        run: async function(ctx, utils) {
            return utils.executeOpenIn(ctx.path, ctx.appName);
        }
    });
})();
