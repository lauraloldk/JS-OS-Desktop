import os
import re
import tempfile
import zipfile
import json

PLUGIN_ID = 'zip'
PLUGIN_NAME = 'ZIP Filesystem Support'
PLUGIN_VERSION = '1.0.0'
PLUGIN_REQUIRED = False
PLUGIN_DEFAULT_ENABLED = True

_ZIP_PATH_PATTERN = re.compile(r'(?i)\.zip(?=$|/)')


def _normalize_inner_path(value):
    text = str(value or '').replace('\\', '/').strip('/')
    if not text:
        return ''

    parts = []
    for part in text.split('/'):
        if not part or part == '.':
            continue
        if part == '..':
            raise ValueError('Parent path traversal is not allowed inside zip paths')
        parts.append(part)

    return '/'.join(parts)


def _split_zip_virtual_path(path_value):
    normalized = str(path_value or '').replace('\\', '/').strip('/')
    if not normalized:
        return None, None

    match = _ZIP_PATH_PATTERN.search(normalized)
    if not match:
        return None, None

    archive_rel = normalized[:match.end()]
    remainder = normalized[match.end():]
    if remainder.startswith('/'):
        remainder = remainder[1:]

    inner_rel = _normalize_inner_path(remainder)
    return archive_rel, inner_rel


def _resolve_zip_archive(archive_rel, context):
    resolve_fs_path = context['resolve_fs_path']
    archive_virtual, archive_abs = resolve_fs_path(archive_rel)

    if not os.path.isfile(archive_abs):
        raise FileNotFoundError(f'Zip archive not found: {archive_virtual}')

    if not zipfile.is_zipfile(archive_abs):
        raise ValueError(f'File is not a valid zip archive: {archive_virtual}')

    return archive_virtual, archive_abs


def _zip_passwords_path(context):
    return os.path.join(context['base_dir'], 'data', 'zip-passwords.json')


def _load_zip_passwords(context):
    path = _zip_passwords_path(context)
    if not os.path.isfile(path):
        return {}

    try:
        with open(path, 'r', encoding='utf-8') as f:
            data = json.load(f)
    except Exception:
        return {}

    return data if isinstance(data, dict) else {}


def _save_zip_passwords(context, data):
    path = _zip_passwords_path(context)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(data if isinstance(data, dict) else {}, f, indent=2, ensure_ascii=False)


def _normalize_zip_key(path_value):
    text = str(path_value or '').replace('\\', '/').strip('/')
    return text.lower()


def _find_zip_root(path_value):
    normalized = str(path_value or '').replace('\\', '/').strip('/')
    match = _ZIP_PATH_PATTERN.search(normalized)
    if not match:
        return ''
    return normalized[:match.end()]


def _is_encrypted_archive(archive_abs):
    with zipfile.ZipFile(archive_abs, 'r') as zf:
        return any((info.flag_bits & 0x1) != 0 for info in zf.infolist())


def _password_bytes_for_archive(archive_virtual, context):
    passwords = _load_zip_passwords(context)
    password = passwords.get(_normalize_zip_key(archive_virtual), '')
    password_text = str(password or '')
    return password_text.encode('utf-8') if password_text else None


def _decode_bytes(data):
    for encoding in ('utf-8', 'cp1252', 'latin-1'):
        try:
            return data.decode(encoding)
        except Exception:
            continue
    return data.decode('utf-8', errors='replace')


def _parent_virtual_path(archive_virtual, inner_rel):
    if inner_rel:
        return f'{archive_virtual}/{inner_rel}'
    return archive_virtual


def map_host_entry(entry, absolute_path, context):
    if not isinstance(entry, dict):
        return None

    if entry.get('type') != 'file':
        return None

    name = str(entry.get('name') or '')
    if not name.lower().endswith('.zip'):
        return None

    if not os.path.isfile(absolute_path):
        return None

    if not zipfile.is_zipfile(absolute_path):
        return None

    mapped = dict(entry)
    mapped['type'] = 'directory'
    mapped['plugin'] = PLUGIN_ID
    return mapped


def list_entries(path_value, context):
    archive_rel, inner_rel = _split_zip_virtual_path(path_value)
    if not archive_rel:
        return None

    archive_virtual, archive_abs = _resolve_zip_archive(archive_rel, context)
    prefix = f'{inner_rel}/' if inner_rel else ''

    buckets = {}
    found_prefix = False

    with zipfile.ZipFile(archive_abs, 'r') as zf:
        for info in zf.infolist():
            zip_name = str(info.filename or '').replace('\\', '/').strip('/')
            if not zip_name:
                continue

            if inner_rel and zip_name == inner_rel:
                found_prefix = True
                continue

            if inner_rel:
                if not zip_name.startswith(prefix):
                    continue
                found_prefix = True
                remainder = zip_name[len(prefix):]
            else:
                remainder = zip_name

            if not remainder:
                continue

            first, _, tail = remainder.partition('/')
            if not first:
                continue

            is_dir = bool(tail) or info.is_dir()
            existing = buckets.get(first)
            if existing:
                if is_dir:
                    existing['type'] = 'directory'
                continue

            child_inner = f'{inner_rel}/{first}' if inner_rel else first
            child_path = f'{archive_virtual}/{child_inner}'
            buckets[first] = {
                'name': first,
                'path': child_path,
                'type': 'directory' if is_dir else 'file',
                'plugin': PLUGIN_ID
            }

    entries = sorted(buckets.values(), key=lambda item: (item.get('type') != 'directory', item.get('name', '').lower()))

    if inner_rel and not found_prefix and not entries:
        raise FileNotFoundError(f'Directory not found: {_parent_virtual_path(archive_virtual, inner_rel)}')

    return {
        'path': _parent_virtual_path(archive_virtual, inner_rel),
        'entries': entries
    }


def read_file(path_value, context):
    archive_rel, inner_rel = _split_zip_virtual_path(path_value)
    if not archive_rel or not inner_rel:
        return None

    archive_virtual, archive_abs = _resolve_zip_archive(archive_rel, context)

    if inner_rel.endswith('/'):
        raise FileNotFoundError(f'File not found: {archive_virtual}/{inner_rel}')

    archive_pwd = _password_bytes_for_archive(archive_virtual, context)

    with zipfile.ZipFile(archive_abs, 'r') as zf:
        try:
            if archive_pwd:
                data = zf.read(inner_rel, pwd=archive_pwd)
            else:
                data = zf.read(inner_rel)
        except KeyError as exc:
            raise FileNotFoundError(f'File not found: {archive_virtual}/{inner_rel}') from exc
        except RuntimeError as exc:
            if 'password required' in str(exc).lower() or 'bad password' in str(exc).lower():
                raise PermissionError(f'Password required or incorrect for zip archive: {archive_virtual}') from exc
            raise

    return {
        'path': f'{archive_virtual}/{inner_rel}',
        'content': _decode_bytes(data)
    }


def _rewrite_zip_with_updates(archive_abs, writer):
    temp_file = None
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix='.zip', dir=os.path.dirname(archive_abs)) as tmp:
            temp_file = tmp.name

        with zipfile.ZipFile(archive_abs, 'r') as source_zip:
            with zipfile.ZipFile(temp_file, 'w', compression=zipfile.ZIP_DEFLATED) as target_zip:
                writer(source_zip, target_zip)

        os.replace(temp_file, archive_abs)
    finally:
        if temp_file and os.path.exists(temp_file):
            try:
                os.remove(temp_file)
            except Exception:
                pass


def write_file(path_value, content, context):
    archive_rel, inner_rel = _split_zip_virtual_path(path_value)
    if not archive_rel or not inner_rel:
        return None

    archive_virtual, archive_abs = _resolve_zip_archive(archive_rel, context)
    normalized_inner = _normalize_inner_path(inner_rel)
    if not normalized_inner:
        raise ValueError('Cannot write to zip root')

    encoded = str(content).encode('utf-8')

    def writer(source_zip, target_zip):
        target_key = normalized_inner.rstrip('/')
        for info in source_zip.infolist():
            key = str(info.filename or '').replace('\\', '/').rstrip('/')
            if key == target_key:
                continue
            target_zip.writestr(info, source_zip.read(info.filename))

        target_zip.writestr(normalized_inner, encoded)

    _rewrite_zip_with_updates(archive_abs, writer)

    return {
        'path': f'{archive_virtual}/{normalized_inner}'
    }


def make_directory(path_value, context):
    archive_rel, inner_rel = _split_zip_virtual_path(path_value)
    if not archive_rel or not inner_rel:
        return None

    archive_virtual, archive_abs = _resolve_zip_archive(archive_rel, context)
    normalized_inner = _normalize_inner_path(inner_rel)
    if not normalized_inner:
        return {
            'path': archive_virtual
        }

    dir_marker = f"{normalized_inner.rstrip('/')}/"

    with zipfile.ZipFile(archive_abs, 'a', compression=zipfile.ZIP_DEFLATED) as zf:
        existing = set(str(name or '').replace('\\', '/') for name in zf.namelist())
        if dir_marker not in existing:
            zf.writestr(dir_marker, b'')

    return {
        'path': f'{archive_virtual}/{normalized_inner}'
    }


def _create_new_zip(target_dir_rel, context):
    resolve_fs_path = context['resolve_fs_path']
    target_dir, target_abs = resolve_fs_path(target_dir_rel or '')

    if not os.path.isdir(target_abs):
        raise FileNotFoundError(f'Directory not found: {target_dir or "/"}')

    base_name = 'new-archive'
    index = 0
    while True:
        suffix = '' if index == 0 else f'-{index}'
        file_name = f'{base_name}{suffix}.zip'
        rel = '/'.join(filter(None, [target_dir, file_name]))
        _, abs_path = resolve_fs_path(rel)
        if not os.path.exists(abs_path):
            with zipfile.ZipFile(abs_path, 'w', compression=zipfile.ZIP_DEFLATED):
                pass
            return rel
        index += 1


def _resolve_selected_zip(payload):
    selected = str((payload or {}).get('selectedPath') or '').replace('\\', '/').strip('/')
    if selected and selected.lower().endswith('.zip'):
        return selected

    current = str((payload or {}).get('currentPath') or '').replace('\\', '/').strip('/')
    if current.lower().endswith('.zip'):
        return current

    return ''


def get_ui_extensions(target, payload, context):
    if target != 'jsexplorer.plugin-menu':
        return []

    return [
        {
            'kind': 'plugin-action',
            'id': 'zip.new_zip',
            'label': 'New ZIP',
            'actionId': 'zip.new_zip'
        },
        {
            'kind': 'plugin-action',
            'id': 'zip.add_password',
            'label': 'Add ZIP Password',
            'actionId': 'zip.add_password'
        },
        {
            'kind': 'plugin-action',
            'id': 'zip.remove_password',
            'label': 'Remove ZIP Password',
            'actionId': 'zip.remove_password'
        }
    ]


def execute_plugin_action(action_id, payload, context):
    if action_id == 'zip.new_zip':
        new_zip_rel = _create_new_zip(str((payload or {}).get('currentPath') or '').strip('/'), context)
        return {
            'message': f'ZIP created: {new_zip_rel}',
            'path': new_zip_rel
        }

    if action_id == 'zip.add_password':
        selected_zip = _resolve_selected_zip(payload)
        if not selected_zip:
            raise ValueError('Select a .zip file (or open a .zip path) before adding password')

        archive_rel = _find_zip_root(selected_zip)
        if not archive_rel:
            raise ValueError('Selected path is not a zip archive')

        archive_virtual, archive_abs = _resolve_zip_archive(archive_rel, context)
        if not _is_encrypted_archive(archive_abs):
            raise ValueError('This zip does not use encryption. Password can only be stored for encrypted zips.')

        password = str((payload or {}).get('password') or '').strip()
        if not password:
            raise ValueError('Password is required')

        store = _load_zip_passwords(context)
        store[_normalize_zip_key(archive_virtual)] = password
        _save_zip_passwords(context, store)
        return {
            'message': f'Password stored for {archive_virtual}'
        }

    if action_id == 'zip.remove_password':
        selected_zip = _resolve_selected_zip(payload)
        if not selected_zip:
            raise ValueError('Select a .zip file (or open a .zip path) before removing password')

        archive_rel = _find_zip_root(selected_zip)
        if not archive_rel:
            raise ValueError('Selected path is not a zip archive')

        archive_virtual, _ = _resolve_zip_archive(archive_rel, context)
        store = _load_zip_passwords(context)
        removed = store.pop(_normalize_zip_key(archive_virtual), None)
        _save_zip_passwords(context, store)
        return {
            'message': 'Password removed' if removed is not None else 'No stored password for this zip'
        }

    return None
