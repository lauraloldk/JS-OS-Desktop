(function() {
	'use strict';

	const DISCOVER_ENDPOINT = '../settings/discover';
	const READ_ENDPOINT = '../settings/read';
	const SAVE_ENDPOINT = '../settings/save';

	let selectedPath = '';
	let originalData = null;
	let currentCategory = '';
	let currentSubcategory = '';

	function showStatus(message, type) {
		const status = document.getElementById('status');
		status.textContent = message;
		status.className = type || '';
	}

	function clearStatus() {
		const status = document.getElementById('status');
		status.textContent = '';
		status.className = '';
	}

	function normalizeLabel(key) {
		return String(key || '')
			.replace(/[_-]+/g, ' ')
			.replace(/([a-z])([A-Z])/g, '$1 $2')
			.replace(/\s+/g, ' ')
			.trim()
			.replace(/^./, function(char) { return char.toUpperCase(); });
	}

	function inferFieldType(key, value, meta) {
		if (meta && typeof meta.type === 'string') {
			return meta.type.toLowerCase();
		}

		const keyName = String(key || '').toLowerCase();

		if (typeof value === 'boolean') {
			return 'bool';
		}

		if (typeof value === 'number') {
			return 'number';
		}

		if (typeof value === 'string') {
			if (/^#[0-9a-f]{6}$/i.test(value)) {
				return 'color';
			}
			if (keyName.includes('date') && keyName.includes('time')) {
				return 'datetime-local';
			}
			if (keyName.includes('date')) {
				return 'date';
			}
			if (keyName.includes('time') || keyName.includes('clock')) {
				return 'time';
			}
			if (value.length > 80 || value.includes('\n')) {
				return 'longtext';
			}
			return 'string';
		}

		if (Array.isArray(value) || (value && typeof value === 'object')) {
			return 'json';
		}

		return 'string';
	}

	function getEditableSettings(data) {
		if (data && typeof data === 'object' && data.settings && typeof data.settings === 'object' && !Array.isArray(data.settings)) {
			return data.settings;
		}
		return data;
	}

	function getMeta(data) {
		if (data && typeof data === 'object' && data.settingsMeta && typeof data.settingsMeta === 'object') {
			return data.settingsMeta;
		}
		return {};
	}

	function normalizeCategoryName(value, fallback) {
		const text = String(value || '').trim();
		return text || fallback;
	}

	function buildCategoryIndex(editable, meta) {
		const index = {};

		Object.keys(editable || {}).forEach(function(key) {
			const fieldMeta = meta[key] || {};
			const category = normalizeCategoryName(fieldMeta.category, 'General');
			const subcategory = normalizeCategoryName(fieldMeta.subcategory, 'General');

			if (!index[category]) {
				index[category] = { all: [], subcategories: {} };
			}

			index[category].all.push(key);

			if (!index[category].subcategories[subcategory]) {
				index[category].subcategories[subcategory] = [];
			}

			index[category].subcategories[subcategory].push(key);
		});

		return index;
	}

	function filterKeys(editable, meta) {
		const index = buildCategoryIndex(editable, meta);
		const allKeys = Object.keys(editable || {});

		if (!currentCategory) {
			return allKeys;
		}

		const categoryBucket = index[currentCategory];
		if (!categoryBucket) {
			return allKeys;
		}

		if (!currentSubcategory) {
			return categoryBucket.all;
		}

		return categoryBucket.subcategories[currentSubcategory] || [];
	}

	function getFilterLabel() {
		if (!currentCategory) {
			return 'All Settings (God Mode)';
		}

		if (!currentSubcategory) {
			return `${currentCategory} / All Settings (God Mode)`;
		}

		return `${currentCategory} / ${currentSubcategory}`;
	}

	function setActiveCategoryButton() {
		document.querySelectorAll('.category-item').forEach(function(button) {
			const isActive =
				button.dataset.category === currentCategory &&
				button.dataset.subcategory === currentSubcategory;
			button.classList.toggle('active', isActive);
		});
	}

	function setFilterAndRender(category, subcategory) {
		currentCategory = category || '';
		currentSubcategory = subcategory || '';

		if (selectedPath && originalData) {
			renderEditor(selectedPath, originalData);
		}
	}

	function ensureValidFilter(editable, meta) {
		const index = buildCategoryIndex(editable, meta);

		if (!currentCategory) {
			currentSubcategory = '';
			return;
		}

		if (!index[currentCategory]) {
			currentCategory = '';
			currentSubcategory = '';
			return;
		}

		if (currentSubcategory && !index[currentCategory].subcategories[currentSubcategory]) {
			currentSubcategory = '';
		}
	}

	function createCategoryButton(text, category, subcategory, extraClass) {
		const button = document.createElement('button');
		button.className = `category-item${extraClass ? ` ${extraClass}` : ''}`;
		button.textContent = text;
		button.dataset.category = category || '';
		button.dataset.subcategory = subcategory || '';
		button.addEventListener('click', function() {
			setFilterAndRender(category, subcategory);
		});
		return button;
	}

	function renderCategories(data) {
		const container = document.getElementById('settingsCategories');
		container.innerHTML = '';

		const editable = getEditableSettings(data);
		const meta = getMeta(data);
		const index = buildCategoryIndex(editable, meta);
		const categoryNames = Object.keys(index).sort(function(a, b) {
			return a.localeCompare(b);
		});

		if (!Object.keys(editable || {}).length) {
			const empty = document.createElement('div');
			empty.id = 'emptyState';
			empty.textContent = 'No categories available for this file.';
			container.appendChild(empty);
			return;
		}

		container.appendChild(createCategoryButton('All Settings (God Mode)', '', '', 'root'));

		categoryNames.forEach(function(categoryName) {
			const group = document.createElement('div');
			group.className = 'category-group';

			const title = document.createElement('h3');
			title.className = 'category-title';
			title.textContent = categoryName;
			group.appendChild(title);

			group.appendChild(
				createCategoryButton('All Settings (God Mode)', categoryName, '', '')
			);

			Object.keys(index[categoryName].subcategories)
				.sort(function(a, b) { return a.localeCompare(b); })
				.forEach(function(subcategoryName) {
					group.appendChild(
						createCategoryButton(subcategoryName, categoryName, subcategoryName, 'sub')
					);
				});

			container.appendChild(group);
		});

		setActiveCategoryButton();
	}

	function valueToInputValue(type, value) {
		if (value === null || value === undefined) {
			return '';
		}

		if (type === 'json') {
			return JSON.stringify(value, null, 2);
		}

		return String(value);
	}

	function readFieldValue(type, input, oldValue) {
		if (type === 'bool') {
			return !!input.checked;
		}

		if (type === 'number') {
			const num = Number(input.value);
			return Number.isFinite(num) ? num : 0;
		}

		if (type === 'json') {
			try {
				return JSON.parse(input.value);
			} catch (error) {
				return oldValue;
			}
		}

		return input.value;
	}

	function createFieldElement(key, value, meta) {
		const field = document.createElement('div');
		const type = inferFieldType(key, value, meta);
		const labelText = (meta && meta.label) || normalizeLabel(key);

		const label = document.createElement('label');
		label.textContent = labelText;
		field.appendChild(label);

		let input;
		if (type === 'longtext' || type === 'json') {
			input = document.createElement('textarea');
			input.value = valueToInputValue(type, value);
		} else if (type === 'bool') {
			field.classList.add('bool-field');
			input = document.createElement('input');
			input.type = 'checkbox';
			input.checked = !!value;
			label.insertAdjacentElement('afterend', input);
		} else {
			input = document.createElement('input');
			input.type = type === 'string' ? 'text' : type;
			input.value = valueToInputValue(type, value);
		}

		if (type !== 'bool') {
			field.appendChild(input);
		}

		field.classList.add('field');
		field.dataset.key = key;
		field.dataset.type = type;

		if (meta && meta.description) {
			const description = document.createElement('small');
			description.textContent = meta.description;
			field.appendChild(description);
		}

		return field;
	}

	function renderEditor(path, data) {
		const header = document.getElementById('editorHeader');
		const editor = document.getElementById('settingsEditor');
		const saveButton = document.getElementById('saveButton');
		const reloadButton = document.getElementById('reloadButton');

		header.textContent = path;
		editor.innerHTML = '';

		const editable = getEditableSettings(data);
		const meta = getMeta(data);
		ensureValidFilter(editable, meta);
		renderCategories(data);

		const keys = filterKeys(editable, meta);
		header.textContent = `${path} - ${getFilterLabel()}`;

		if (!keys.length) {
			const empty = document.createElement('div');
			empty.id = 'emptyState';
			empty.textContent = 'No settings found in this category.';
			editor.appendChild(empty);
		} else {
			keys.forEach(function(key) {
				const field = createFieldElement(key, editable[key], meta[key]);
				editor.appendChild(field);
			});
		}

		saveButton.disabled = false;
		reloadButton.disabled = false;
	}

	async function discoverSettingsFiles() {
		const response = await fetch(DISCOVER_ENDPOINT, { cache: 'no-store' });
		const data = await response.json();
		if (!response.ok) {
			throw new Error(data.error || `Discover failed (${response.status})`);
		}
		return Array.isArray(data.files) ? data.files : [];
	}

	async function loadSettingsFile(path) {
		const response = await fetch(`${READ_ENDPOINT}?path=${encodeURIComponent(path)}`, { cache: 'no-store' });
		const data = await response.json();
		if (!response.ok) {
			throw new Error(data.error || `Read failed (${response.status})`);
		}
		return data;
	}

	async function saveSettingsFile(path, data) {
		const response = await fetch(SAVE_ENDPOINT, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({ path: path, data: data })
		});

		const payload = await response.json();
		if (!response.ok || payload.status !== 'success') {
			throw new Error(payload.message || `Save failed (${response.status})`);
		}
	}

	function setActiveFileButton(path) {
		document.querySelectorAll('.file-item').forEach(function(button) {
			button.classList.toggle('active', button.dataset.path === path);
		});
	}

	async function openSettingsPath(path) {
		clearStatus();
		const payload = await loadSettingsFile(path);
		selectedPath = payload.path;
		originalData = payload.data;
		currentCategory = '';
		currentSubcategory = '';
		renderEditor(selectedPath, originalData);
		setActiveFileButton(selectedPath);
	}

	function collectCurrentData() {
		if (!originalData) {
			return null;
		}

		const nextData = JSON.parse(JSON.stringify(originalData));
		const editable = getEditableSettings(nextData);
		const originalEditable = getEditableSettings(originalData);

		document.querySelectorAll('#settingsEditor .field').forEach(function(field) {
			const key = field.dataset.key;
			const type = field.dataset.type;
			const input = field.querySelector('input, textarea, select');
			if (!input || !(key in editable)) {
				return;
			}

			editable[key] = readFieldValue(type, input, originalEditable[key]);
		});

		return nextData;
	}

	async function saveCurrentFile() {
		if (!selectedPath || !originalData) {
			return;
		}

		const data = collectCurrentData();
		await saveSettingsFile(selectedPath, data);
		originalData = data;
		showStatus('Settings saved successfully.', 'success');

		// Keep desktop colors in sync for existing OS settings format.
		try {
			const editable = getEditableSettings(data);
			if (window.parent && window.parent !== window) {
				const canvas = window.parent.document.getElementById('canvas');
				const taskbar = window.parent.document.getElementById('taskbar');
				if (canvas && editable.desktopcolor) {
					canvas.style.backgroundColor = editable.desktopcolor;
				}
				if (taskbar && editable.taskbarcolor) {
					taskbar.style.backgroundColor = editable.taskbarcolor;
				}
			}
		} catch (error) {
			// Best-effort visual sync only.
		}
	}

	async function renderFileList() {
		const filesContainer = document.getElementById('settingsFiles');
		filesContainer.innerHTML = '';

		const files = await discoverSettingsFiles();
		if (!files.length) {
			filesContainer.textContent = 'No editable config JSON files found.';
			return;
		}

		files.forEach(function(path) {
			const button = document.createElement('button');
			button.className = 'file-item';
			button.textContent = path;
			button.dataset.path = path;
			button.addEventListener('click', function() {
				openSettingsPath(path).catch(function(error) {
					showStatus(error.message, 'error');
				});
			});
			filesContainer.appendChild(button);
		});

		await openSettingsPath(files[0]);
	}

	function bindEvents() {
		document.getElementById('saveButton').addEventListener('click', function() {
			saveCurrentFile().catch(function(error) {
				showStatus(error.message, 'error');
			});
		});

		document.getElementById('reloadButton').addEventListener('click', function() {
			if (!selectedPath) {
				return;
			}
			openSettingsPath(selectedPath).catch(function(error) {
				showStatus(error.message, 'error');
			});
		});
	}

	async function init() {
		bindEvents();

		try {
			await renderFileList();
			clearStatus();
		} catch (error) {
			showStatus(error.message, 'error');
		}
	}

	document.addEventListener('DOMContentLoaded', init);
})();
