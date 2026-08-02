import json
import os

PLUGIN_ID = 'devtools'
PLUGIN_NAME = 'Developer Tools'
PLUGIN_VERSION = '1.0.0'
PLUGIN_REQUIRED = False
PLUGIN_DEFAULT_ENABLED = False


ALLOWED_META_TYPES = {
    'string',
    'longtext',
    'bool',
    'number',
    'json',
    'color',
    'date',
    'time',
    'datetime-local'
}


def _normalize_path(path_value):
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


def _is_allowed_settings_file(rel_path):
    lower_rel = str(rel_path or '').lower().replace('\\', '/')
    if not lower_rel.endswith('.json'):
        return False

    if lower_rel.startswith('data/'):
        return True

    return 'settings' in os.path.basename(lower_rel)


def _resolve_project_path(rel_path, context):
    normalized = _normalize_path(rel_path)
    if not _is_allowed_settings_file(normalized):
        raise ValueError('File is not allowed in settings manager')

    base_dir = os.path.abspath(str(context.get('base_dir') or ''))
    if not base_dir:
        raise ValueError('Project base directory is unavailable')

    target = os.path.abspath(os.path.join(base_dir, normalized))
    if target != base_dir and not target.startswith(base_dir + os.sep):
        raise ValueError('Path escapes project root')

    return normalized, target


def _load_json_object(abs_path, rel_path):
    if not os.path.isfile(abs_path):
        raise FileNotFoundError(f'File not found: {rel_path}')

    with open(abs_path, 'r', encoding='utf-8') as f:
        data = json.load(f)

    if not isinstance(data, dict):
        raise ValueError('Settings JSON must be an object at root')

    return data


def _save_json_object(abs_path, data):
    with open(abs_path, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


def _normalize_key(value):
    key = str(value or '').strip()
    if not key:
        raise ValueError('Key is required')
    return key


def _normalize_meta(payload):
    meta = {
        'label': str((payload or {}).get('label', '')).strip(),
        'description': str((payload or {}).get('description', '')).strip(),
        'category': str((payload or {}).get('category', '')).strip(),
        'subcategory': str((payload or {}).get('subcategory', '')).strip()
    }

    field_type = str((payload or {}).get('type', '')).strip().lower()
    if field_type:
        if field_type not in ALLOWED_META_TYPES:
            raise ValueError('Unsupported field type')
        meta['type'] = field_type

    return {key: value for key, value in meta.items() if value}


def _extract_settings_and_meta(data):
    settings = data.get('settings') if isinstance(data.get('settings'), dict) else None
    metadata = data.get('settingsMeta') if isinstance(data.get('settingsMeta'), dict) else None

    if settings is not None:
        return settings, metadata if metadata is not None else {}, True

    if metadata is not None:
        return data, metadata, False

    return data, {}, False


def _build_entries(settings, metadata):
    entries = []
    for key in sorted(settings.keys(), key=lambda item: str(item).lower()):
        entries.append({
            'key': key,
            'value': settings.get(key),
            'meta': metadata.get(key, {}) if isinstance(metadata.get(key), dict) else {}
        })
    return entries


def _action_list(payload, context):
    rel_path, abs_path = _resolve_project_path((payload or {}).get('path', ''), context)
    data = _load_json_object(abs_path, rel_path)
    settings, metadata, _ = _extract_settings_and_meta(data)

    if not isinstance(settings, dict):
        raise ValueError('Settings object is missing')

    return {
        'path': rel_path,
        'entries': _build_entries(settings, metadata)
    }


def _action_create(payload, context):
    rel_path, abs_path = _resolve_project_path((payload or {}).get('path', ''), context)
    data = _load_json_object(abs_path, rel_path)
    settings, metadata, wrapped = _extract_settings_and_meta(data)

    if not isinstance(settings, dict):
        raise ValueError('Settings object is missing')

    key = _normalize_key((payload or {}).get('key', ''))
    if key in settings:
        raise ValueError(f'Setting already exists: {key}')

    settings[key] = (payload or {}).get('value', '')
    metadata[key] = _normalize_meta(payload)

    if wrapped:
        data['settings'] = settings
        data['settingsMeta'] = metadata
    else:
        data['settingsMeta'] = metadata

    _save_json_object(abs_path, data)

    return {
        'path': rel_path,
        'key': key,
        'created': True
    }


def _action_update(payload, context):
    rel_path, abs_path = _resolve_project_path((payload or {}).get('path', ''), context)
    data = _load_json_object(abs_path, rel_path)
    settings, metadata, wrapped = _extract_settings_and_meta(data)

    if not isinstance(settings, dict):
        raise ValueError('Settings object is missing')

    old_key = _normalize_key((payload or {}).get('oldKey', ''))
    new_key = _normalize_key((payload or {}).get('key', old_key))

    if old_key not in settings:
        raise ValueError(f'Setting not found: {old_key}')

    if new_key != old_key and new_key in settings:
        raise ValueError(f'Setting already exists: {new_key}')

    value = (payload or {}).get('value')
    if new_key == old_key:
        settings[old_key] = value
        metadata[old_key] = _normalize_meta(payload)
    else:
        settings[new_key] = value
        settings.pop(old_key, None)

        metadata[new_key] = _normalize_meta(payload)
        metadata.pop(old_key, None)

    if wrapped:
        data['settings'] = settings
        data['settingsMeta'] = metadata
    else:
        data['settingsMeta'] = metadata

    _save_json_object(abs_path, data)

    return {
        'path': rel_path,
        'key': new_key,
        'updated': True
    }


def _action_delete(payload, context):
    rel_path, abs_path = _resolve_project_path((payload or {}).get('path', ''), context)
    data = _load_json_object(abs_path, rel_path)
    settings, metadata, wrapped = _extract_settings_and_meta(data)

    if not isinstance(settings, dict):
        raise ValueError('Settings object is missing')

    key = _normalize_key((payload or {}).get('key', ''))
    if key not in settings:
        raise ValueError(f'Setting not found: {key}')

    settings.pop(key, None)
    metadata.pop(key, None)

    if wrapped:
        data['settings'] = settings
        data['settingsMeta'] = metadata
    else:
        data['settingsMeta'] = metadata

    _save_json_object(abs_path, data)

    return {
        'path': rel_path,
        'key': key,
        'deleted': True
    }


def get_ui_extensions(target, payload, context):
    if target != 'settings.sections':
        return []

    return [
        {
            'kind': 'callback',
            'id': 'devtools.settings_string_manager',
            'label': 'Settings String Manager',
            'section': 'Devtools'
        }
    ]


def execute_plugin_action(action_id, payload, context):
    payload = payload if isinstance(payload, dict) else {}

    if action_id == 'devtools.settings.list':
        return _action_list(payload, context)

    if action_id == 'devtools.settings.create':
        return _action_create(payload, context)

    if action_id == 'devtools.settings.update':
        return _action_update(payload, context)

    if action_id == 'devtools.settings.delete':
        return _action_delete(payload, context)

    return None
