from typing import Any, Dict, List


def list_actions(target: str, payload: Dict[str, Any], context: Dict[str, Any]) -> List[Dict[str, Any]]:
    if target != 'notepad':
        return []

    return [
        {'id': 'notepad.new', 'label': 'New Document'},
        {'id': 'notepad.open', 'label': 'Open File'},
        {'id': 'notepad.save', 'label': 'Save'},
        {'id': 'notepad.save_as', 'label': 'Save As'}
    ]


def execute_action(target: str, action_id: str, payload: Dict[str, Any], context: Dict[str, Any]) -> Dict[str, Any]:
    return {'handled': False}
