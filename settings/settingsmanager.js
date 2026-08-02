(function() {
	'use strict';

	const DISCOVER_ENDPOINT = '../settings/discover';
	const READ_ENDPOINT = '../settings/read';
	const SAVE_ENDPOINT = '../settings/save';
	const PLUGIN_EXTENSIONS_ENDPOINT = '../plugins/extensions';
	const PLUGIN_EXECUTE_ENDPOINT = '../plugins/execute';

	let selectedPath = '';
	let originalData = null;
	let currentCategory = '';
	let currentSubcategory = '';
	let pluginSections = [];
	let devtoolsEntries = [];
	let devtoolsSelectedKey = '';

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

	function showDevtoolsStatus(message, type) {
		const status = document.getElementById('devtoolsStatus');
		if (!status) {
			return;
		}

		status.textContent = message;
		status.className = type || '';
	}

	function clearDevtoolsStatus() {
		showDevtoolsStatus('', '');
	}

	function escapeHtml(text) {
		return String(text === undefined || text === null ? '' : text)
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;')
			.replace(/'/g, '&#039;');
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

	async function getPluginExtensions(target, payload) {
		const query = new URLSearchParams({
			target: String(target || ''),
			payload: JSON.stringify(payload || {})
		});

		const response = await fetch(`${PLUGIN_EXTENSIONS_ENDPOINT}?${query.toString()}`, {
			cache: 'no-store'
		});

		const data = await response.json();
		if (!response.ok) {
			throw new Error(data.error || `Plugin extension load failed (${response.status})`);
		}

		return Array.isArray(data.extensions) ? data.extensions : [];
	}

	async function executePluginAction(actionId, payload) {
		const response = await fetch(PLUGIN_EXECUTE_ENDPOINT, {
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

	function setModalVisible(visible) {
		const modal = document.getElementById('devtoolsModal');
		if (!modal) {
			return;
		}

		if (visible) {
			modal.classList.add('show');
			modal.setAttribute('aria-hidden', 'false');
		} else {
			modal.classList.remove('show');
			modal.setAttribute('aria-hidden', 'true');
		}
	}

	function parseDevtoolsValue(rawValue) {
		const text = String(rawValue || '').trim();
		if (!text) {
			return '';
		}

		try {
			return JSON.parse(text);
		} catch (error) {
			return rawValue;
		}
	}

	function getDevtoolsFormData() {
		return {
			key: document.getElementById('devtoolsKey').value.trim(),
			type: document.getElementById('devtoolsType').value,
			category: document.getElementById('devtoolsCategory').value.trim(),
			subcategory: document.getElementById('devtoolsSubcategory').value.trim(),
			label: document.getElementById('devtoolsLabel').value.trim(),
			description: document.getElementById('devtoolsDescription').value.trim(),
			value: parseDevtoolsValue(document.getElementById('devtoolsValue').value)
		};
	}

	function clearDevtoolsForm() {
		document.getElementById('devtoolsKey').value = '';
		document.getElementById('devtoolsType').value = 'string';
		document.getElementById('devtoolsCategory').value = '';
		document.getElementById('devtoolsSubcategory').value = '';
		document.getElementById('devtoolsLabel').value = '';
		document.getElementById('devtoolsDescription').value = '';
		document.getElementById('devtoolsValue').value = '';
		devtoolsSelectedKey = '';
	}

	function populateDevtoolsForm(entry) {
		const meta = (entry && entry.meta && typeof entry.meta === 'object') ? entry.meta : {};
		document.getElementById('devtoolsKey').value = entry ? (entry.key || '') : '';
		document.getElementById('devtoolsType').value = String(meta.type || inferFieldType(entry ? entry.key : '', entry ? entry.value : '', meta) || 'string');
		document.getElementById('devtoolsCategory').value = String(meta.category || '');
		document.getElementById('devtoolsSubcategory').value = String(meta.subcategory || '');
		document.getElementById('devtoolsLabel').value = String(meta.label || '');
		document.getElementById('devtoolsDescription').value = String(meta.description || '');
		document.getElementById('devtoolsValue').value = JSON.stringify(entry ? entry.value : '', null, 2);
	}

	function renderDevtoolsRows() {
		const body = document.getElementById('devtoolsRows');
		if (!body) {
			return;
		}

		body.innerHTML = '';

		if (!selectedPath) {
			body.innerHTML = '<tr><td colspan="6">Select a settings file first.</td></tr>';
			return;
		}

		if (!devtoolsEntries.length) {
			body.innerHTML = '<tr><td colspan="6">No settings strings found in this file.</td></tr>';
			return;
		}

		devtoolsEntries.forEach(function(entry) {
			const meta = (entry.meta && typeof entry.meta === 'object') ? entry.meta : {};
			const type = meta.type || inferFieldType(entry.key, entry.value, meta);
			const row = document.createElement('tr');
			if (devtoolsSelectedKey && devtoolsSelectedKey === entry.key) {
				row.classList.add('active');
			}

			const valuePreview = (typeof entry.value === 'string')
				? entry.value
				: JSON.stringify(entry.value);

			row.innerHTML = [
				`<td>${escapeHtml(entry.key)}</td>`,
				`<td>${escapeHtml(type)}</td>`,
				`<td>${escapeHtml(meta.category || '')}</td>`,
				`<td>${escapeHtml(meta.subcategory || '')}</td>`,
				`<td>${escapeHtml(valuePreview)}</td>`,
				'<td class="actions-cell"><button type="button" class="button secondary">Edit</button></td>'
			].join('');

			row.querySelector('button').addEventListener('click', function() {
				devtoolsSelectedKey = entry.key;
				populateDevtoolsForm(entry);
				renderDevtoolsRows();
				clearDevtoolsStatus();
			});

			body.appendChild(row);
		});
	}

	async function refreshCurrentFileView() {
		if (!selectedPath) {
			return;
		}

		const payload = await loadSettingsFile(selectedPath);
		originalData = payload.data;
		renderEditor(selectedPath, originalData);
	}

	async function loadDevtoolsEntries() {
		if (!selectedPath) {
			devtoolsEntries = [];
			renderDevtoolsRows();
			return;
		}

		const result = await executePluginAction('devtools.settings.list', { path: selectedPath });
		devtoolsEntries = Array.isArray(result.entries) ? result.entries : [];
		renderDevtoolsRows();
	}

	async function createDevtoolsEntry() {
		if (!selectedPath) {
			throw new Error('Select a settings file before creating entries');
		}

		const formData = getDevtoolsFormData();
		await executePluginAction('devtools.settings.create', {
			path: selectedPath,
			...formData
		});

		clearDevtoolsForm();
		await Promise.all([refreshCurrentFileView(), loadDevtoolsEntries()]);
		showDevtoolsStatus('Setting created successfully.', 'success');
	}

	async function updateDevtoolsEntry() {
		if (!selectedPath) {
			throw new Error('Select a settings file before updating entries');
		}

		if (!devtoolsSelectedKey) {
			throw new Error('Select an existing entry first');
		}

		const formData = getDevtoolsFormData();
		await executePluginAction('devtools.settings.update', {
			path: selectedPath,
			oldKey: devtoolsSelectedKey,
			...formData
		});

		devtoolsSelectedKey = formData.key;
		await Promise.all([refreshCurrentFileView(), loadDevtoolsEntries()]);
		showDevtoolsStatus('Setting updated successfully.', 'success');
	}

	async function deleteDevtoolsEntry() {
		if (!selectedPath) {
			throw new Error('Select a settings file before deleting entries');
		}

		if (!devtoolsSelectedKey) {
			throw new Error('Select an existing entry first');
		}

		if (!window.confirm(`Delete setting "${devtoolsSelectedKey}"?`)) {
			return;
		}

		await executePluginAction('devtools.settings.delete', {
			path: selectedPath,
			key: devtoolsSelectedKey
		});

		clearDevtoolsForm();
		await Promise.all([refreshCurrentFileView(), loadDevtoolsEntries()]);
		showDevtoolsStatus('Setting removed successfully.', 'success');
	}

	async function openDevtoolsManager() {
		setModalVisible(true);
		clearDevtoolsStatus();
		await loadDevtoolsEntries();
	}

	async function handlePluginSection(section) {
		const sectionId = String((section || {}).id || '').trim();
		if (sectionId === 'devtools.settings_string_manager') {
			await openDevtoolsManager();
			return;
		}

		throw new Error(`Unknown plugin section: ${sectionId}`);
	}

	async function renderPluginSections() {
		const container = document.getElementById('settingsPluginSections');
		container.innerHTML = '';

		try {
			pluginSections = await getPluginExtensions('settings.sections', {
				selectedPath: selectedPath || ''
			});
		} catch (error) {
			container.innerHTML = `<div id="emptyState">${escapeHtml(error.message)}</div>`;
			return;
		}

		if (!pluginSections.length) {
			container.innerHTML = '<div id="emptyState">No plugin sections available.</div>';
			return;
		}

		pluginSections.forEach(function(section) {
			const button = document.createElement('button');
			button.type = 'button';
			button.className = 'plugin-section-item';
			button.textContent = section.label || section.id || 'Plugin Section';
			button.addEventListener('click', function() {
				handlePluginSection(section).catch(function(error) {
					showStatus(error.message, 'error');
				});
			});
			container.appendChild(button);
		});
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
		await renderPluginSections();
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
				if (window.parent.JSOSWindows && typeof window.parent.JSOSWindows.applyWindowColor === 'function') {
					window.parent.JSOSWindows.applyWindowColor(editable.windowcolor || '');
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
			await renderPluginSections();
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

		document.getElementById('devtoolsCloseButton').addEventListener('click', function() {
			setModalVisible(false);
		});

		document.getElementById('devtoolsCreateButton').addEventListener('click', function() {
			createDevtoolsEntry().catch(function(error) {
				showDevtoolsStatus(error.message, 'error');
			});
		});

		document.getElementById('devtoolsUpdateButton').addEventListener('click', function() {
			updateDevtoolsEntry().catch(function(error) {
				showDevtoolsStatus(error.message, 'error');
			});
		});

		document.getElementById('devtoolsDeleteButton').addEventListener('click', function() {
			deleteDevtoolsEntry().catch(function(error) {
				showDevtoolsStatus(error.message, 'error');
			});
		});

		document.getElementById('devtoolsResetButton').addEventListener('click', function() {
			clearDevtoolsForm();
			renderDevtoolsRows();
			clearDevtoolsStatus();
		});

		document.getElementById('devtoolsModal').addEventListener('click', function(event) {
			if (event.target && event.target.id === 'devtoolsModal') {
				setModalVisible(false);
			}
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
