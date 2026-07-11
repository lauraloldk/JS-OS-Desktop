import importlib.util
import os
import sys
from typing import Dict, List, Any


sys.dont_write_bytecode = True


BASE_DIR = os.path.dirname(os.path.abspath(__file__))
ACTIONS_DIR = os.path.join(BASE_DIR, 'actions')


def _load_action_modules() -> List[Any]:
	modules = []

	if not os.path.isdir(ACTIONS_DIR):
		return modules

	for filename in sorted(os.listdir(ACTIONS_DIR)):
		if not filename.endswith('.py'):
			continue
		if filename.startswith('_'):
			continue

		module_path = os.path.join(ACTIONS_DIR, filename)
		module_name = f'actions_runtime_{filename[:-3]}'

		spec = importlib.util.spec_from_file_location(module_name, module_path)
		if spec is None or spec.loader is None:
			continue

		module = importlib.util.module_from_spec(spec)
		spec.loader.exec_module(module)
		modules.append(module)

	return modules


def list_actions(target: str, payload: Dict[str, Any], context: Dict[str, Any]) -> List[Dict[str, Any]]:
	actions = []

	for module in _load_action_modules():
		provider = getattr(module, 'list_actions', None)
		if callable(provider):
			provided_actions = provider(target, payload, context)
			if isinstance(provided_actions, list):
				actions.extend(provided_actions)

	return actions


def execute_action(target: str, action_id: str, payload: Dict[str, Any], context: Dict[str, Any]) -> Dict[str, Any]:
	for module in _load_action_modules():
		executor = getattr(module, 'execute_action', None)
		if not callable(executor):
			continue

		result = executor(target, action_id, payload, context)
		if isinstance(result, dict) and result.get('handled'):
			return result

	return {
		'handled': False,
		'status': 'error',
		'message': f'Unknown action: {action_id}'
	}
