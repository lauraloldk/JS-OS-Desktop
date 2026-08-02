import os
import shutil

PLUGIN_ID = 'jsexplorer_tools'
PLUGIN_NAME = 'JSExplorer Tools'
PLUGIN_VERSION = '1.0.0'
PLUGIN_REQUIRED = False
PLUGIN_DEFAULT_ENABLED = True
PLUGIN_DEPENDS_OPTIONAL = ['zip']


def _safe_norm(path_value, context):
    normalize = context.get('normalize_virtual_path')
    if callable(normalize):
        return normalize(path_value)
    return str(path_value or '').replace('\\', '/').strip('/')


def _unique_file_name(directory_abs, base_name, extension):
    index = 0
    while True:
        suffix = '' if index == 0 else f'-{index}'
        candidate = f"{base_name}{suffix}{extension}"
        if not os.path.exists(os.path.join(directory_abs, candidate)):
            return candidate
        index += 1


def _create_new_text_file(current_path, context):
    resolve_fs_path = context.get('resolve_fs_path')
    if not callable(resolve_fs_path):
        raise ValueError('Filesystem context is unavailable')

    current_norm = _safe_norm(current_path, context)
    current_rel, current_abs = resolve_fs_path(current_norm)
    if not os.path.isdir(current_abs):
        raise FileNotFoundError(f'Directory not found: {current_rel or "/"}')

    file_name = _unique_file_name(current_abs, 'new-file', '.txt')
    rel = '/'.join(filter(None, [current_rel, file_name]))
    _, abs_path = resolve_fs_path(rel)

    with open(abs_path, 'w', encoding='utf-8') as f:
        f.write('')

    return rel


def _duplicate_selected_file(selected_path, context):
    resolve_fs_path = context.get('resolve_fs_path')
    if not callable(resolve_fs_path):
        raise ValueError('Filesystem context is unavailable')

    selected_norm = _safe_norm(selected_path, context)
    if not selected_norm:
        raise ValueError('Select a file first')

    selected_rel, selected_abs = resolve_fs_path(selected_norm)
    if not os.path.isfile(selected_abs):
        raise FileNotFoundError(f'File not found: {selected_rel}')

    base_dir = os.path.dirname(selected_rel).replace('\\', '/').strip('/')
    file_name = os.path.basename(selected_rel)

    if '.' in file_name:
        stem, ext = file_name.rsplit('.', 1)
        ext = f'.{ext}'
    else:
        stem = file_name
        ext = ''

    target_name = _unique_file_name(os.path.dirname(selected_abs), f'{stem}-copy', ext)
    target_rel = '/'.join(filter(None, [base_dir, target_name]))
    _, target_abs = resolve_fs_path(target_rel)

    shutil.copy2(selected_abs, target_abs)
    return target_rel


def get_ui_extensions(target, payload, context):
    if target != 'jsexplorer.plugin-menu':
        return []

    return [
        {
            'kind': 'plugin-action',
            'id': 'jsexplorer_tools.new_text_file',
            'label': 'New Text File',
            'actionId': 'jsexplorer_tools.new_text_file'
        },
        {
            'kind': 'plugin-action',
            'id': 'jsexplorer_tools.duplicate_selected',
            'label': 'Duplicate Selected File',
            'actionId': 'jsexplorer_tools.duplicate_selected'
        }
    ]


def execute_plugin_action(action_id, payload, context):
    payload = payload if isinstance(payload, dict) else {}

    if action_id == 'jsexplorer_tools.new_text_file':
        rel = _create_new_text_file(payload.get('currentPath', ''), context)
        return {
            'message': f'Created file: {rel}',
            'path': rel
        }

    if action_id == 'jsexplorer_tools.duplicate_selected':
        selected_type = str(payload.get('selectedType') or '').lower().strip()
        if selected_type and selected_type != 'file':
            raise ValueError('Only files can be duplicated')

        rel = _duplicate_selected_file(payload.get('selectedPath', ''), context)
        return {
            'message': f'Duplicated file: {rel}',
            'path': rel
        }

    return None
