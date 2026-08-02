import os
import re

PLUGIN_ID = 'notepad_tools'
PLUGIN_NAME = 'Notepad Tools'
PLUGIN_VERSION = '1.0.0'
PLUGIN_REQUIRED = False
PLUGIN_DEFAULT_ENABLED = True
PLUGIN_DEPENDS_OPTIONAL = ['zip']


def _normalize_text(value):
    return str(value or '')


def _safe_norm(path_value, context):
    normalize = context.get('normalize_virtual_path')
    if callable(normalize):
        return normalize(path_value)
    return str(path_value or '').replace('\\', '/').strip('/')


def _build_backup_path(current_path):
    if '.' in current_path.split('/')[-1]:
        stem, ext = current_path.rsplit('.', 1)
        return f"{stem}.backup.{ext}"
    return f"{current_path}.backup.txt"


def get_ui_extensions(target, payload, context):
    if target != 'notepad.plugin-menu':
        return []

    return [
        {
            'kind': 'plugin-action',
            'id': 'notepad_tools.word_count',
            'label': 'Word Count',
            'actionId': 'notepad_tools.word_count'
        },
        {
            'kind': 'plugin-action',
            'id': 'notepad_tools.save_backup',
            'label': 'Save Backup Copy',
            'actionId': 'notepad_tools.save_backup'
        }
    ]


def execute_plugin_action(action_id, payload, context):
    if action_id == 'notepad_tools.word_count':
        content = _normalize_text((payload or {}).get('content'))
        words = len(re.findall(r"\S+", content))
        chars = len(content)
        lines = content.count('\n') + (1 if content else 0)
        return {
            'message': f'Words: {words} | Characters: {chars} | Lines: {lines}'
        }

    if action_id == 'notepad_tools.save_backup':
        payload = payload if isinstance(payload, dict) else {}
        current_path = _safe_norm(payload.get('currentPath', ''), context)
        if not current_path:
            raise ValueError('Current file must be saved before backup can be created')

        resolve_fs_path = context.get('resolve_fs_path')
        if not callable(resolve_fs_path):
            raise ValueError('Filesystem context is unavailable')

        _, source_abs = resolve_fs_path(current_path)
        if not os.path.isfile(source_abs):
            raise FileNotFoundError(f'File not found: {current_path}')

        backup_rel = _build_backup_path(current_path)
        _, backup_abs = resolve_fs_path(backup_rel)

        os.makedirs(os.path.dirname(backup_abs), exist_ok=True)
        with open(backup_abs, 'w', encoding='utf-8') as f:
            f.write(_normalize_text(payload.get('content')))

        return {
            'message': f'Backup saved: {backup_rel}',
            'path': backup_rel
        }

    return None
