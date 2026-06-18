import os
from typing import Any, Dict, List


def _safe_join(root: str, relative_path: str) -> str:
    clean = str(relative_path or '').replace('\\', '/').strip('/').strip()
    parts = []
    for part in clean.split('/') if clean else []:
        if not part or part == '.':
            continue
        if part == '..':
            raise ValueError('Parent path traversal is not allowed')
        parts.append(part)
    absolute = os.path.abspath(os.path.join(root, *parts))
    root_abs = os.path.abspath(root)
    if absolute != root_abs and not absolute.startswith(root_abs + os.sep):
        raise ValueError('Path escapes files root')
    return absolute


def list_actions(target: str, payload: Dict[str, Any], context: Dict[str, Any]) -> List[Dict[str, Any]]:
    if target != 'jsexplorer':
        return []

    actions = [
        {'id': 'jsexplorer.new_folder', 'label': 'New Folder'}
    ]

    entry = payload.get('entry') if isinstance(payload, dict) else None
    if isinstance(entry, dict):
        actions.insert(0, {'id': 'jsexplorer.open', 'label': 'Open'})
        if entry.get('type') == 'file':
            actions.insert(1, {'id': 'jsexplorer.open_notepad', 'label': 'Open In Notepad'})

    return actions


def execute_action(target: str, action_id: str, payload: Dict[str, Any], context: Dict[str, Any]) -> Dict[str, Any]:
    if target != 'jsexplorer':
        return {'handled': False}

    if action_id != 'jsexplorer.new_folder':
        return {'handled': False}

    try:
        root = context.get('files_root')
        if not root:
            raise ValueError('Missing files_root in context')

        parent_path = str(payload.get('path') or '').strip()
        name = str(payload.get('name') or '').strip()
        if not name:
            raise ValueError('Folder name is required')

        full_path = '/'.join(filter(None, [parent_path.replace('\\', '/').strip('/'), name]))
        target_path = _safe_join(root, full_path)
        os.makedirs(target_path, exist_ok=True)
        return {'handled': True, 'status': 'success', 'path': full_path.replace('\\', '/')}
    except Exception as exc:
        return {'handled': True, 'status': 'error', 'message': str(exc)}
