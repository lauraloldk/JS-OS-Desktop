(function() {
    'use strict';

    if (!window.JSOSCmd || typeof window.JSOSCmd.register !== 'function' || typeof window.JSOSCmd.setOpenInProvider !== 'function') {
        return;
    }

    const cmd = window.JSOSCmd;

    function isExplicitPath(pathValue) {
        const value = String(pathValue || '');
        return value.includes('/') || /\.zip(?:$|\/)/i.test(value);
    }

    function getExplorerBasePaths() {
        const contexts = [];

        const activeFromContext = cmd.normalizePath(
            window.JSOSCmdContext && typeof window.JSOSCmdContext === 'object'
                ? window.JSOSCmdContext.activeExplorerPath
                : ''
        );
        if (activeFromContext) {
            contexts.push({ path: activeFromContext, active: true });
        }

        const registerWindowContext = function(windowNode) {
            if (!windowNode) {
                return;
            }

            const iframe = windowNode.querySelector('iframe.window-content');
            if (!iframe) {
                return;
            }

            const src = String(iframe.getAttribute('src') || '').toLowerCase();
            if (!src.includes('apps/jsexplorer/index.html')) {
                return;
            }

            try {
                const doc = iframe.contentWindow && iframe.contentWindow.document;
                const pathInput = doc ? doc.getElementById('pathInput') : null;
                const basePath = cmd.normalizePath(pathInput ? pathInput.value : '');
                if (!basePath) {
                    return;
                }

                const isActive = windowNode.classList.contains('window-active');
                contexts.push({ path: basePath, active: isActive });
            } catch (error) {
                // Ignore iframe access issues.
            }
        };

        document.querySelectorAll('.window').forEach(registerWindowContext);

        contexts.sort(function(a, b) {
            return Number(b.active) - Number(a.active);
        });

        const unique = [];
        const seen = new Set();
        contexts.forEach(function(item) {
            if (seen.has(item.path)) {
                return;
            }
            seen.add(item.path);
            unique.push(item.path);
        });

        return unique;
    }

    function buildPathCandidates(inputPath) {
        const clean = cmd.normalizePath(cmd.stripQuotes(inputPath));
        if (!clean) {
            return [];
        }

        const candidates = [clean];
        if (!isExplicitPath(clean)) {
            const contextEntries = (
                window.JSOSCmdContext && typeof window.JSOSCmdContext === 'object'
                    ? window.JSOSCmdContext.activeExplorerEntries
                    : []
            );

            if (Array.isArray(contextEntries)) {
                contextEntries.forEach(function(entry) {
                    if (!entry || typeof entry !== 'object') {
                        return;
                    }

                    const entryName = String(entry.name || '').trim().toLowerCase();
                    const entryPath = cmd.normalizePath(String(entry.path || ''));
                    if (!entryName || !entryPath) {
                        return;
                    }

                    if (entryName === clean.toLowerCase() && !candidates.includes(entryPath)) {
                        candidates.push(entryPath);
                    }
                });
            }

            getExplorerBasePaths().forEach(function(basePath) {
                const candidate = cmd.normalizePath(`${basePath}/${clean}`);
                if (candidate && !candidates.includes(candidate)) {
                    candidates.push(candidate);
                }
            });
        }

        return candidates;
    }

    async function findPathByFileName(fileName) {
        const target = String(fileName || '').trim().toLowerCase();
        if (!target) {
            return '';
        }

        const queue = [''];
        const visited = new Set();
        let scanned = 0;
        const maxScannedDirectories = 4000;

        while (queue.length) {
            const dir = queue.shift();
            const dirKey = String(dir || '').toLowerCase();
            if (visited.has(dirKey)) {
                continue;
            }
            visited.add(dirKey);

            if (scanned >= maxScannedDirectories) {
                break;
            }
            scanned += 1;

            let listing;
            try {
                listing = await cmd.requestJson(`/fs/list?path=${encodeURIComponent(dir)}`, { cache: 'no-store' });
            } catch (error) {
                continue;
            }

            const entries = Array.isArray(listing.entries) ? listing.entries : [];
            for (const entry of entries) {
                if (!entry || typeof entry !== 'object') {
                    continue;
                }

                const entryName = String(entry.name || '').trim().toLowerCase();
                const entryPath = cmd.normalizePath(String(entry.path || ''));
                const entryType = String(entry.type || '').toLowerCase();
                if (!entryPath) {
                    continue;
                }

                if (entryName === target) {
                    return entryPath;
                }

                if (entryType === 'directory') {
                    queue.push(entryPath);
                }
            }
        }

        return '';
    }

    async function openNotepad(filePath) {
        const opener = cmd.getOpenTarget();
        if (!opener) {
            throw new Error('Window system is not available in this context');
        }

        const candidates = buildPathCandidates(filePath);
        if (!candidates.length) {
            throw new Error('Missing file path in command');
        }

        let resolvedPath = '';
        for (const candidate of candidates) {
            try {
                await cmd.requestJson(`/fs/read?path=${encodeURIComponent(candidate)}`, { cache: 'no-store' });
                resolvedPath = candidate;
                break;
            } catch (error) {
                // Try next candidate.
            }
        }

        if (!resolvedPath) {
            throw new Error(`Cannot open file in Notepad: ${candidates[0]}`);
        }

        const fileName = resolvedPath.split('/').pop() || resolvedPath;
        opener.createWindow(`Notepad - ${fileName}`, `apps/notepad/index.html?path=${encodeURIComponent(resolvedPath)}`);
        return `Opened ${resolvedPath} in Notepad`;
    }

    async function openJSExplorer(targetPath) {
        const opener = cmd.getOpenTarget();
        if (!opener) {
            throw new Error('Window system is not available in this context');
        }

        const candidates = buildPathCandidates(targetPath);
        if (!candidates.length) {
            opener.createWindow('JSExplorer', 'apps/jsexplorer/index.html');
            return 'Opened JSExplorer';
        }

        for (const candidate of candidates) {
            try {
                await cmd.requestJson(`/fs/list?path=${encodeURIComponent(candidate)}`, { cache: 'no-store' });
                opener.createWindow('JSExplorer', `apps/jsexplorer/index.html?path=${encodeURIComponent(candidate)}`);
                return `Opened folder ${candidate} in JSExplorer`;
            } catch (dirError) {
                try {
                    const fileData = await cmd.requestJson(`/fs/read?path=${encodeURIComponent(candidate)}`, { cache: 'no-store' });
                    const file = String(fileData.path || candidate);
                    const parts = file.split('/').filter(Boolean);
                    const selected = parts.pop() || file;
                    const parentPath = parts.join('/');

                    const query = new URLSearchParams();
                    if (parentPath) {
                        query.set('path', parentPath);
                    }
                    query.set('select', selected);

                    opener.createWindow('JSExplorer', `apps/jsexplorer/index.html?${query.toString()}`);
                    return `Opened folder for ${file} in JSExplorer`;
                } catch (fileError) {
                    // Try next candidate.
                }
            }
        }

        if (!isExplicitPath(candidates[0])) {
            const foundPath = await findPathByFileName(candidates[0]);
            if (foundPath) {
                const foundParts = foundPath.split('/').filter(Boolean);
                const foundSelected = foundParts.pop() || foundPath;
                const foundParent = foundParts.join('/');

                const query = new URLSearchParams();
                if (foundParent) {
                    query.set('path', foundParent);
                }
                query.set('select', foundSelected);

                opener.createWindow('JSExplorer', `apps/jsexplorer/index.html?${query.toString()}`);
                return `Opened folder for ${foundPath} in JSExplorer`;
            }
        }

        const fallback = candidates[0];
        const parts = fallback.split('/').filter(Boolean);
        const selected = parts.pop() || fallback;
        const parentPath = parts.join('/');

        if (parentPath) {
            try {
                await cmd.requestJson(`/fs/list?path=${encodeURIComponent(parentPath)}`, { cache: 'no-store' });
                const query = new URLSearchParams();
                query.set('path', parentPath);
                query.set('select', selected);
                opener.createWindow('JSExplorer', `apps/jsexplorer/index.html?${query.toString()}`);
                return `Opened folder for ${fallback} in JSExplorer`;
            } catch (error) {
                // Continue to final error below.
            }
        }

        throw new Error(`Path not found: ${fallback}`);
    }

    async function executeOpenIn(filePath, appName) {
        const app = String(appName || '').trim().toLowerCase();

        if (app === 'notepad') {
            return openNotepad(filePath);
        }

        if (app === 'jsexplorer') {
            return openJSExplorer(filePath);
        }

        throw new Error(`Unsupported app: ${app}`);
    }

    cmd.setOpenInProvider({
        executeOpenIn: executeOpenIn
    });

    cmd.register({
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
