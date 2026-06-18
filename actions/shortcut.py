import json
import os
from typing import Dict, Any, List


def _normalize(value: Any) -> str:
    return str(value or '').strip().lower()


def _target_key(target: Dict[str, Any]) -> str:
    return f"{_normalize(target.get('title'))}::{_normalize(target.get('url'))}"


def list_actions(target: str, payload: Dict[str, Any], context: Dict[str, Any]) -> List[Dict[str, Any]]:
    if target != 'shortcut':
        return []

    return [
        {
            'id': 'shortcut.remove',
            'label': 'Remove Shutcut'
        }
    ]


def execute_action(target: str, action_id: str, payload: Dict[str, Any], context: Dict[str, Any]) -> Dict[str, Any]:
    if target != 'shortcut' or action_id != 'shortcut.remove':
        return {'handled': False}

    shortcuts_file = context.get('shortcuts_file')
    if not shortcuts_file:
        return {
            'handled': True,
            'status': 'error',
            'message': 'Missing shortcuts_file in context'
        }

    try:
        if os.path.exists(shortcuts_file):
            with open(shortcuts_file, 'r', encoding='utf-8') as f:
                data = json.load(f)
        else:
            data = {'shortcuts': []}

        entries = data.get('shortcuts', [])
        if not isinstance(entries, list):
            entries = []

        key_to_remove = _target_key(payload)
        filtered = [entry for entry in entries if _target_key(entry) != key_to_remove]
        removed = len(entries) - len(filtered)

        data['shortcuts'] = filtered
        with open(shortcuts_file, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=2, ensure_ascii=False)

        return {
            'handled': True,
            'status': 'success',
            'removed': removed
        }
    except Exception as exc:
        return {
            'handled': True,
            'status': 'error',
            'message': str(exc)
        }
