(function() {
    'use strict';

    if (!window.JSOSCmd || typeof window.JSOSCmd.register !== 'function') {
        return;
    }

    window.JSOSCmd.register({
        id: 'apps.run',
        usage: 'run <app> | rum <app>',
        description: 'Run an app by name',
        match: function(input) {
            const match = input.match(/^(?:run|rum)\s+([a-zA-Z0-9_-]+)$/i);
            return match ? { appName: match[1] } : null;
        },
        run: async function(ctx, utils) {
            return utils.openApp(ctx.appName);
        }
    });

    window.JSOSCmd.register({
        id: 'apps.direct',
        usage: '<app>',
        description: 'Run an app by typing only the app name',
        match: function(input) {
            if (/\s/.test(input)) {
                return null;
            }
            if (/^(help|run|rum|open)$/i.test(input)) {
                return null;
            }
            return { appName: input };
        },
        run: async function(ctx, utils) {
            return utils.openApp(ctx.appName);
        }
    });
})();
