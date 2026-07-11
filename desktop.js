(function() {
	'use strict';

	const SETTINGS_PATH = 'data/os-settings.json';
	const APPS_ROOT = 'apps';
	const ACTIONS_LIST_ENDPOINT = '/actions/list';

	let desktopMenu;

	function normalizePath(inputPath) {
		if (typeof inputPath !== 'string') {
			throw new Error('Path must be a string');
		}

		const path = inputPath.trim().replace(/\\/g, '/');
		if (!path) {
			throw new Error('Path cannot be empty');
		}

		const parts = [];
		for (const part of path.split('/')) {
			if (!part || part === '.') {
				continue;
			}
			if (part === '..') {
				throw new Error('Parent path traversal is not allowed');
			}
			parts.push(part);
		}

		return parts.join('/');
	}

	async function fetchText(path) {
		const response = await fetch(path, { cache: 'no-store' });
		if (!response.ok) {
			throw new Error(`Could not read file: ${path} (${response.status})`);
		}
		return response.text();
	}

	async function fileExists(path) {
		try {
			const response = await fetch(path, { method: 'HEAD', cache: 'no-store' });
			return response.ok;
		} catch (error) {
			return false;
		}
	}

	async function readJson(path) {
		const response = await fetch(path, { cache: 'no-store' });
		if (!response.ok) {
			throw new Error(`Could not read JSON file: ${path} (${response.status})`);
		}
		return response.json();
	}

	function resolveAppPath(appName) {
		const safeAppName = normalizePath(String(appName || '').toLowerCase());
		return `${APPS_ROOT}/${safeAppName}/index.html`;
	}

	async function runApp(appName) {
		const path = resolveAppPath(appName);
		const exists = await fileExists(path);

		if (!exists) {
			throw new Error(`App not found: ${appName}`);
		}

		createWindow(appName, path);
	}

	async function applyDesktopSettings() {
		const settings = await readJson(SETTINGS_PATH);

		const canvas = document.getElementById('canvas');
		const taskbar = document.getElementById('taskbar');

		if (canvas && settings.desktopcolor) {
			canvas.style.backgroundColor = settings.desktopcolor;
		}

		if (taskbar && settings.taskbarcolor) {
			taskbar.style.backgroundColor = settings.taskbarcolor;
		}
	}

	function updateClock() {
		const clock = document.getElementById('clock');
		if (!clock) {
			return;
		}

		const now = new Date();
		clock.textContent = now.toLocaleTimeString('da-DK', {
			hour: '2-digit',
			minute: '2-digit'
		});
	}

	function ensureDesktopMenu() {
		if (desktopMenu) {
			return desktopMenu;
		}

		desktopMenu = document.createElement('div');
		desktopMenu.className = 'desktop-context-menu hidden';
		document.body.appendChild(desktopMenu);
		return desktopMenu;
	}

	function hideDesktopMenu() {
		if (!desktopMenu) {
			return;
		}
		desktopMenu.classList.add('hidden');
		desktopMenu.innerHTML = '';
	}

	async function fetchDesktopActions() {
		const response = await fetch(`${ACTIONS_LIST_ENDPOINT}?target=desktop&payload=${encodeURIComponent('{}')}`, {
			cache: 'no-store'
		});
		const data = await response.json();
		if (!response.ok) {
			throw new Error(data.error || `Failed to load desktop actions (${response.status})`);
		}
		return Array.isArray(data.actions) ? data.actions : [];
	}

	function handleDesktopAction(actionId) {
		if (actionId === 'desktop.open_explorer') {
			createWindow('JSExplorer', 'apps/jsexplorer/index.html');
			return;
		}

		if (actionId === 'desktop.open_notepad') {
			createWindow('Notepad', 'apps/notepad/index.html');
			return;
		}

		if (actionId === 'desktop.refresh') {
			if (window.JSOSShortcuts && typeof window.JSOSShortcuts.render === 'function') {
				window.JSOSShortcuts.render();
			}
			applyDesktopSettings().catch(function(error) {
				console.error('Failed to refresh desktop settings:', error);
			});
		}
	}

	function injectDesktopMenuStyles() {
		const styleTag = document.createElement('style');
		styleTag.textContent = `
			.desktop-context-menu {
				position: fixed;
				min-width: 220px;
				background: #fff;
				border: 1px solid #b8b8b8;
				border-radius: 10px;
				box-shadow: 0 10px 24px rgba(0, 0, 0, 0.25);
				padding: 8px;
				z-index: 1250;
			}

			.desktop-context-menu.hidden {
				display: none;
			}

			.desktop-context-item {
				width: 100%;
				text-align: left;
				border: 0;
				background: transparent;
				border-radius: 8px;
				padding: 8px 10px;
				cursor: pointer;
			}

			.desktop-context-item:hover {
				background: #eef3ff;
			}
		`;
		document.head.appendChild(styleTag);
	}

	async function openDesktopMenu(event) {
		event.preventDefault();
		const menu = ensureDesktopMenu();
		menu.innerHTML = '';

		try {
			const actions = await fetchDesktopActions();
			actions.forEach(function(action) {
				const button = document.createElement('button');
				button.className = 'desktop-context-item';
				button.textContent = action.label || action.id;
				button.addEventListener('click', function() {
					hideDesktopMenu();
					handleDesktopAction(action.id);
				});
				menu.appendChild(button);
			});
		} catch (error) {
			const errorItem = document.createElement('div');
			errorItem.textContent = error.message;
			menu.appendChild(errorItem);
		}

		menu.style.left = `${event.clientX}px`;
		menu.style.top = `${event.clientY}px`;
		menu.classList.remove('hidden');
	}

	function bindUiEvents() {
		const settingsButton = document.getElementById('settingsButton');
		const canvas = document.getElementById('canvas');

		if (settingsButton) {
			settingsButton.addEventListener('click', function() {
				createWindow('Settings', 'settings/index.html');
			});
		}

		if (canvas) {
			canvas.addEventListener('contextmenu', function(event) {
				if (event.target.closest('.desktop-shortcut') || event.target.closest('.window')) {
					return;
				}
				openDesktopMenu(event);
			});
		}

		document.addEventListener('click', function() {
			hideDesktopMenu();
		});
	}

	async function initDesktop() {
		try {
			await applyDesktopSettings();
		} catch (error) {
			console.error('Failed to load desktop settings:', error);
		}

		bindUiEvents();
		injectDesktopMenuStyles();
		ensureDesktopMenu();
		updateClock();
		setInterval(updateClock, 1000);
	}

	window.JSOSFileSystem = {
		normalizePath,
		exists: fileExists,
		readText: fetchText,
		readJson,
		resolveAppPath,
		runApp
	};

	window.JSOSDesktop = {
		init: initDesktop,
		applySettings: applyDesktopSettings
	};

	document.addEventListener('DOMContentLoaded', initDesktop);
})();
