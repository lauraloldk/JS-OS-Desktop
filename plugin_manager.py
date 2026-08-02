import importlib.util
import json
import os
import shutil
import time


_registry_cache = None
_plugins_cache = None
_paths = {}
_runtime_context = {}


def initialize(base_dir, files_root, runtime_context=None):
    global _paths
    global _runtime_context
    _paths = {
        'base_dir': os.path.abspath(base_dir),
        'files_root': os.path.abspath(files_root),
        'plugins_dir': os.path.join(os.path.abspath(base_dir), 'plugins'),
        'packages_dir': os.path.join(os.path.abspath(base_dir), 'packages'),
        'registry_file': os.path.join(os.path.abspath(base_dir), 'data', 'plugins.json')
    }
    _runtime_context = dict(runtime_context or {})

    _ensure_registry_file()
    _reload_plugins()


def _ensure_initialized():
    if not _paths:
        raise RuntimeError('plugin_manager is not initialized')


def _ensure_registry_file():
    _ensure_initialized()
    registry_file = _paths['registry_file']
    os.makedirs(os.path.dirname(registry_file), exist_ok=True)

    if not os.path.isfile(registry_file):
        with open(registry_file, 'w', encoding='utf-8') as f:
            json.dump({'plugins': {}, 'packages': {}}, f, indent=2, ensure_ascii=False)


def _load_registry():
    global _registry_cache

    _ensure_initialized()
    if _registry_cache is not None:
        return _registry_cache

    registry_file = _paths['registry_file']
    try:
        with open(registry_file, 'r', encoding='utf-8') as f:
            data = json.load(f)
    except Exception:
        data = {}

    if not isinstance(data, dict):
        data = {}

    if not isinstance(data.get('plugins'), dict):
        data['plugins'] = {}

    if not isinstance(data.get('packages'), dict):
        data['packages'] = {}

    _registry_cache = data
    return _registry_cache


def _save_registry():
    _ensure_initialized()
    data = _load_registry()

    with open(_paths['registry_file'], 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


def _safe_rel_path(path_value):
    text = str(path_value or '').replace('\\', '/').strip('/').strip()
    if not text:
        raise ValueError('Path is required')

    parts = []
    for part in text.split('/'):
        if not part or part == '.':
            continue
        if part == '..':
            raise ValueError('Parent path traversal is not allowed')
        parts.append(part)

    if not parts:
        raise ValueError('Path is required')

    return '/'.join(parts)


def _resolve_inside(base_path, relative_path):
    rel = _safe_rel_path(relative_path)
    candidate = os.path.abspath(os.path.join(base_path, rel))
    base_abs = os.path.abspath(base_path)

    if candidate != base_abs and not candidate.startswith(base_abs + os.sep):
        raise ValueError('Path escapes allowed root')

    return candidate


def _iter_plugin_files():
    _ensure_initialized()
    plugins_dir = _paths['plugins_dir']
    if not os.path.isdir(plugins_dir):
        return []

    results = []
    for filename in sorted(os.listdir(plugins_dir), key=lambda value: value.lower()):
        if not filename.endswith('.py'):
            continue
        if filename.startswith('_'):
            continue
        results.append(os.path.join(plugins_dir, filename))
    return results


def _normalize_dependency_list(value):
    if value is None:
        return []

    if isinstance(value, str):
        items = [value]
    elif isinstance(value, (list, tuple, set)):
        items = list(value)
    else:
        return []

    result = []
    seen = set()
    for item in items:
        text = str(item or '').strip()
        if not text:
            continue
        if text in seen:
            continue
        seen.add(text)
        result.append(text)

    return result


def _reload_plugins():
    global _plugins_cache

    registry = _load_registry()
    plugins = []

    for file_path in _iter_plugin_files():
        module_name = f"jsos_plugin_{os.path.splitext(os.path.basename(file_path))[0]}"
        try:
            spec = importlib.util.spec_from_file_location(module_name, file_path)
            if spec is None or spec.loader is None:
                continue

            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)

            plugin_id = str(getattr(module, 'PLUGIN_ID', os.path.splitext(os.path.basename(file_path))[0]))
            plugin_name = str(getattr(module, 'PLUGIN_NAME', plugin_id))
            plugin_version = str(getattr(module, 'PLUGIN_VERSION', '0.0.0'))
            required = bool(getattr(module, 'PLUGIN_REQUIRED', False))
            default_enabled = bool(getattr(module, 'PLUGIN_DEFAULT_ENABLED', True))
            required_dependencies = _normalize_dependency_list(getattr(module, 'PLUGIN_DEPENDS_REQUIRED', []))
            optional_dependencies = _normalize_dependency_list(getattr(module, 'PLUGIN_DEPENDS_OPTIONAL', []))
        except Exception as error:
            print(f"Failed to load plugin file {file_path}: {error}")
            continue

        item = registry['plugins'].get(plugin_id)
        if not isinstance(item, dict):
            item = {}

        if 'enabled' not in item:
            item['enabled'] = default_enabled

        if required:
            item['enabled'] = True

        item['required'] = required
        item['name'] = plugin_name
        item['version'] = plugin_version
        item['source'] = 'builtin'
        item['requiredDependencies'] = required_dependencies
        item['optionalDependencies'] = optional_dependencies

        registry['plugins'][plugin_id] = item

        plugins.append({
            'id': plugin_id,
            'name': plugin_name,
            'version': plugin_version,
            'required': required,
            'default_enabled': default_enabled,
            'required_dependencies': required_dependencies,
            'optional_dependencies': optional_dependencies,
            'enabled': bool(item.get('enabled', False)),
            'module': module
        })

    _plugins_cache = plugins
    _save_registry()
    return _plugins_cache


def _get_plugins():
    if _plugins_cache is None:
        return _reload_plugins()
    return _plugins_cache


def list_plugins():
    plugins = _get_plugins()
    plugin_state = {plugin['id']: bool(plugin['enabled']) for plugin in plugins}

    def state_map(dep_ids):
        items = []
        for dep_id in dep_ids:
            items.append({
                'id': dep_id,
                'found': dep_id in plugin_state,
                'enabled': bool(plugin_state.get(dep_id, False))
            })
        return items

    return [
        {
            'id': plugin['id'],
            'name': plugin['name'],
            'version': plugin['version'],
            'enabled': plugin['enabled'],
            'required': plugin['required'],
            'defaultEnabled': plugin['default_enabled'],
            'requiredDependencies': state_map(plugin['required_dependencies']),
            'optionalDependencies': state_map(plugin['optional_dependencies'])
        }
        for plugin in plugins
    ]


def _find_plugin(plugins, plugin_id):
    for plugin in plugins:
        if plugin['id'] == plugin_id:
            return plugin
    return None


def _validate_required_dependencies_enabled(plugins, plugin):
    plugin_by_id = {item['id']: item for item in plugins}

    missing = []
    disabled = []
    for dep_id in plugin.get('required_dependencies', []):
        dep_plugin = plugin_by_id.get(dep_id)
        if dep_plugin is None:
            missing.append(dep_id)
            continue
        if not dep_plugin.get('enabled'):
            disabled.append(dep_id)

    if missing or disabled:
        parts = []
        if missing:
            parts.append(f"missing: {', '.join(missing)}")
        if disabled:
            parts.append(f"disabled: {', '.join(disabled)}")
        details = '; '.join(parts)
        raise ValueError(
            f"Cannot enable plugin {plugin.get('id')}. Required dependencies are not satisfied ({details})"
        )


def _validate_disable_not_required_by_enabled_plugins(plugins, plugin_id):
    blocked_by = []
    for item in plugins:
        if not item.get('enabled'):
            continue
        if plugin_id in item.get('required_dependencies', []):
            blocked_by.append(item.get('id'))

    if blocked_by:
        raise ValueError(
            f"Cannot disable plugin {plugin_id}. Required by enabled plugin(s): {', '.join(blocked_by)}"
        )


def set_plugin_enabled(plugin_id, enabled):
    registry = _load_registry()
    plugins = _get_plugins()

    target = _find_plugin(plugins, plugin_id)

    if target is None:
        raise ValueError(f'Plugin not found: {plugin_id}')

    if target['required'] and not enabled:
        raise ValueError(f'Plugin {plugin_id} is required and cannot be disabled')

    if enabled:
        _validate_required_dependencies_enabled(plugins, target)
    else:
        _validate_disable_not_required_by_enabled_plugins(plugins, plugin_id)

    item = registry['plugins'].get(plugin_id)
    if not isinstance(item, dict):
        item = {}

    item['enabled'] = bool(enabled)
    item['required'] = bool(target['required'])
    item['name'] = target['name']
    item['version'] = target['version']
    item['source'] = 'builtin'
    item['requiredDependencies'] = list(target.get('required_dependencies', []))
    item['optionalDependencies'] = list(target.get('optional_dependencies', []))
    registry['plugins'][plugin_id] = item

    _save_registry()
    _reload_plugins()

    return {
        'id': plugin_id,
        'enabled': bool(enabled)
    }


def _read_package_manifest(package_id):
    _ensure_initialized()
    package_rel = _safe_rel_path(package_id)
    package_dir = _resolve_inside(_paths['packages_dir'], package_rel)
    manifest_path = os.path.join(package_dir, 'manifest.json')

    if not os.path.isfile(manifest_path):
        raise FileNotFoundError(f'Package manifest not found: {package_rel}/manifest.json')

    with open(manifest_path, 'r', encoding='utf-8') as f:
        manifest = json.load(f)

    if not isinstance(manifest, dict):
        raise ValueError('Package manifest must be a JSON object')

    pkg_id = str(manifest.get('id') or package_rel)
    version = str(manifest.get('version') or '0.0.0')
    name = str(manifest.get('name') or pkg_id)
    install = manifest.get('install')

    if not isinstance(install, list) or not install:
        raise ValueError('Package manifest must include a non-empty install array')

    return package_dir, {
        'id': pkg_id,
        'name': name,
        'version': version,
        'install': install
    }


def list_packages():
    _ensure_initialized()
    registry = _load_registry()
    installed = registry.get('packages', {})

    results = []
    packages_dir = _paths['packages_dir']
    if not os.path.isdir(packages_dir):
        return results

    for name in sorted(os.listdir(packages_dir), key=lambda value: value.lower()):
        package_dir = os.path.join(packages_dir, name)
        if not os.path.isdir(package_dir):
            continue

        try:
            _, manifest = _read_package_manifest(name)
        except Exception:
            continue

        state = installed.get(manifest['id'])
        installed_version = state.get('version') if isinstance(state, dict) else None

        results.append({
            'id': manifest['id'],
            'name': manifest['name'],
            'version': manifest['version'],
            'installedVersion': installed_version,
            'isInstalled': bool(installed_version)
        })

    return results


def _find_package_by_id(package_id):
    package_key = str(package_id or '').strip()
    if not package_key:
        raise ValueError('Package id is required')

    packages_dir = _paths['packages_dir']
    if not os.path.isdir(packages_dir):
        raise FileNotFoundError('No packages directory found')

    for name in sorted(os.listdir(packages_dir), key=lambda value: value.lower()):
        package_dir = os.path.join(packages_dir, name)
        if not os.path.isdir(package_dir):
            continue

        try:
            found_dir, manifest = _read_package_manifest(name)
        except Exception:
            continue

        if manifest.get('id') == package_key:
            return found_dir, manifest

    raise FileNotFoundError(f'Package not found: {package_key}')


def _copy_tree(src_dir, dest_dir):
    for root, dirs, files in os.walk(src_dir):
        dirs[:] = [d for d in dirs if d != '__pycache__']
        rel = os.path.relpath(root, src_dir)
        rel = '' if rel == '.' else rel

        target_root = os.path.join(dest_dir, rel)
        os.makedirs(target_root, exist_ok=True)

        for filename in files:
            if filename.endswith('.pyc'):
                continue
            src_file = os.path.join(root, filename)
            dst_file = os.path.join(target_root, filename)
            os.makedirs(os.path.dirname(dst_file), exist_ok=True)
            shutil.copy2(src_file, dst_file)


def _install_manifest_files(package_dir, manifest):
    for item in manifest['install']:
        if not isinstance(item, dict):
            raise ValueError('Each install entry must be an object')

        src_rel = item.get('from')
        dst_rel = item.get('to')
        if not src_rel or not dst_rel:
            raise ValueError('Install entries must include from and to')

        source = _resolve_inside(package_dir, str(src_rel))
        target = _resolve_inside(_paths['base_dir'], str(dst_rel))

        if os.path.isdir(source):
            os.makedirs(target, exist_ok=True)
            _copy_tree(source, target)
            continue

        if not os.path.isfile(source):
            raise FileNotFoundError(f'Package source not found: {src_rel}')

        os.makedirs(os.path.dirname(target), exist_ok=True)
        shutil.copy2(source, target)


def install_package(package_id, update=False):
    package_dir, manifest = _read_package_manifest(package_id)
    registry = _load_registry()

    installed = registry.get('packages', {})
    existing = installed.get(manifest['id'])
    existing_version = existing.get('version') if isinstance(existing, dict) else None

    if existing_version and not update:
        raise ValueError(f'Package already installed: {manifest["id"]} ({existing_version})')

    if update and not existing_version:
        raise ValueError(f'Package is not installed yet: {manifest["id"]}')

    _install_manifest_files(package_dir, manifest)

    installed[manifest['id']] = {
        'version': manifest['version'],
        'updatedAt': int(time.time())
    }
    registry['packages'] = installed
    _save_registry()

    _reload_plugins()

    return {
        'id': manifest['id'],
        'version': manifest['version'],
        'updated': bool(update)
    }


def uninstall_package(package_id):
    _ensure_initialized()

    package_dir, manifest = _find_package_by_id(package_id)
    registry = _load_registry()
    installed = registry.get('packages', {})
    package_state = installed.get(manifest['id'])
    if not isinstance(package_state, dict) or not package_state.get('version'):
        raise ValueError(f'Package is not installed: {manifest["id"]}')

    removed = []
    for item in manifest['install']:
        if not isinstance(item, dict):
            continue

        dst_rel = item.get('to')
        if not dst_rel:
            continue

        target = _resolve_inside(_paths['base_dir'], str(dst_rel))
        if os.path.isdir(target):
            shutil.rmtree(target)
            removed.append(str(dst_rel))
            continue

        if os.path.isfile(target):
            os.remove(target)
            removed.append(str(dst_rel))

    installed.pop(manifest['id'], None)
    registry['packages'] = installed
    _save_registry()

    _reload_plugins()

    return {
        'id': manifest['id'],
        'removed': removed
    }


def call_hook(hook_name, *args):
    plugins = _get_plugins()

    context = {
        'base_dir': _paths['base_dir'],
        'files_root': _paths['files_root'],
        **_runtime_context
    }

    for plugin in plugins:
        if not plugin['enabled']:
            continue

        hook = getattr(plugin['module'], hook_name, None)
        if not callable(hook):
            continue

        result = hook(*args, context)
        if result is not None:
            return result

    return None


def collect_ui_extensions(target, payload):
    plugins = _get_plugins()

    context = {
        'base_dir': _paths['base_dir'],
        'files_root': _paths['files_root'],
        **_runtime_context
    }

    extensions = []
    for plugin in plugins:
        if not plugin['enabled']:
            continue

        hook = getattr(plugin['module'], 'get_ui_extensions', None)
        if not callable(hook):
            continue

        result = hook(target, payload or {}, context)
        if isinstance(result, list):
            extensions.extend([item for item in result if isinstance(item, dict)])

    return extensions


def execute_plugin_action(action_id, payload):
    plugins = _get_plugins()

    context = {
        'base_dir': _paths['base_dir'],
        'files_root': _paths['files_root'],
        **_runtime_context
    }

    request_payload = payload if isinstance(payload, dict) else {}
    action_key = str(action_id or '').strip()
    if not action_key:
        raise ValueError('Action id is required')

    for plugin in plugins:
        if not plugin['enabled']:
            continue

        hook = getattr(plugin['module'], 'execute_plugin_action', None)
        if not callable(hook):
            continue

        result = hook(action_key, request_payload, context)
        if result is not None:
            if isinstance(result, dict):
                return result
            return {'status': 'success', 'result': result}

    raise ValueError(f'No plugin handled action: {action_key}')
