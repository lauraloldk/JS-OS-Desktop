from typing import Any, Dict, List


def list_actions(target: str, payload: Dict[str, Any], context: Dict[str, Any]) -> List[Dict[str, Any]]:
    if target != 'desktop':
        return []

    return [
        {'id': 'desktop.open_explorer', 'label': 'Open File Manager'},
        {'id': 'desktop.open_notepad', 'label': 'Open Notepad'},
        {'id': 'desktop.refresh', 'label': 'Refresh Desktop'}
    ]


def execute_action(target: str, action_id: str, payload: Dict[str, Any], context: Dict[str, Any]) -> Dict[str, Any]:
    return {'handled': False}
