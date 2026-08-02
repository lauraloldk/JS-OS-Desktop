import os
import re
import tempfile
import zipfile

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

    with zipfile.ZipFile(archive_abs, 'r') as zf:
        try:
            data = zf.read(inner_rel)
        except KeyError as exc:
            raise FileNotFoundError(f'File not found: {archive_virtual}/{inner_rel}') from exc

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
