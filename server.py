import http.server
import socketserver
import os
import json
import urllib.parse
import threading
import re
import time
import importlib
import sys

sys.dont_write_bytecode = True

import actions as actions_core
import plugin_manager

try:
    webview = importlib.import_module('webview')
except ImportError:
    webview = None

PORT = 8000

# Find den mappe hvor denne fil ligger
current_dir = os.path.dirname(os.path.abspath(__file__))
shortcuts_file = os.path.join(current_dir, 'data', 'shortcuts.json')
files_root = os.path.join(current_dir, 'files')

httpd_instance = None
webview_window = None


def resolve_project_path(path_value):
    normalized = str(path_value or '').replace('\\', '/').strip('/').strip()
    if not normalized:
        raise ValueError('Path is required')

    parts = []
    for part in normalized.split('/'):
        if not part or part == '.':
            continue
        if part == '..':
            raise ValueError('Parent path traversal is not allowed')
        parts.append(part)

    if not parts:
        raise ValueError('Path is required')

    rel_path = '/'.join(parts)
    abs_path = os.path.abspath(os.path.join(current_dir, rel_path))
    root_abs = os.path.abspath(current_dir)
    if abs_path != root_abs and not abs_path.startswith(root_abs + os.sep):
        raise ValueError('Path escapes project root')

    return rel_path, abs_path


def is_allowed_settings_file(rel_path):
    lower_rel = str(rel_path or '').lower().replace('\\', '/')
    if not lower_rel.endswith('.json'):
        return False

    # Allow editing all JSON files under data/, and legacy "*settings*.json" files anywhere.
    if lower_rel.startswith('data/'):
        return True

    base_name = os.path.basename(lower_rel)
    return 'settings' in base_name


def discover_settings_json_files():
    matches = set()

    # Discover all JSON files in data/ (shortcuts, window sizes, etc.)
    data_dir = os.path.join(current_dir, 'data')
    if os.path.isdir(data_dir):
        for dirpath, dirnames, filenames in os.walk(data_dir):
            dirnames[:] = [name for name in dirnames if name != '__pycache__']
            for filename in filenames:
                if not filename.lower().endswith('.json'):
                    continue
                file_path = os.path.join(dirpath, filename)
                rel_path = os.path.relpath(file_path, current_dir).replace(os.sep, '/')
                if is_allowed_settings_file(rel_path):
                    matches.add(rel_path)

    # Keep support for settings files outside data/ by name convention.
    for dirpath, dirnames, filenames in os.walk(current_dir):
        dirnames[:] = [name for name in dirnames if name != '__pycache__']
        for filename in filenames:
            lower_name = filename.lower()
            if not lower_name.endswith('.json'):
                continue
            if 'settings' not in lower_name:
                continue

            file_path = os.path.join(dirpath, filename)
            rel_path = os.path.relpath(file_path, current_dir).replace(os.sep, '/')
            if is_allowed_settings_file(rel_path):
                matches.add(rel_path)

    return sorted(matches)


def read_settings_json(path_value):
    rel_path, abs_path = resolve_project_path(path_value)
    if not rel_path.lower().endswith('.json'):
        raise ValueError('Settings file must be a .json file')

    if not is_allowed_settings_file(rel_path):
        raise ValueError('File is not allowed in settings manager')

    if not os.path.isfile(abs_path):
        raise FileNotFoundError(f'File not found: {rel_path}')

    with open(abs_path, 'r', encoding='utf-8') as f:
        data = json.load(f)

    if not isinstance(data, dict):
        raise ValueError('Settings JSON must be an object at root')

    return {'path': rel_path, 'data': data}


def write_settings_json(path_value, data):
    rel_path, abs_path = resolve_project_path(path_value)
    if not rel_path.lower().endswith('.json'):
        raise ValueError('Settings file must be a .json file')

    if not is_allowed_settings_file(rel_path):
        raise ValueError('File is not allowed in settings manager')

    if not isinstance(data, dict):
        raise ValueError('Settings data must be a JSON object')

    with open(abs_path, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2, ensure_ascii=False)

    return {'path': rel_path}


def normalize_virtual_path(path_value):
    normalized = str(path_value or '').replace('\\', '/').strip('/').strip()
    if not normalized:
        return ''

    parts = []
    for part in normalized.split('/'):
        if not part or part == '.':
            continue
        if part == '..':
            raise ValueError('Parent path traversal is not allowed')
        parts.append(part)

    return '/'.join(parts)


def resolve_fs_path(path_value=''):
    os.makedirs(files_root, exist_ok=True)

    normalized = normalize_virtual_path(path_value)
    absolute_path = os.path.abspath(os.path.join(files_root, normalized))

    root_abs = os.path.abspath(files_root)
    if absolute_path != root_abs and not absolute_path.startswith(root_abs + os.sep):
        raise ValueError('Path escapes files root')

    return normalized, absolute_path


def list_fs_entries(path_value=''):
    normalized = normalize_virtual_path(path_value)

    plugin_result = plugin_manager.call_hook('list_entries', normalized)
    if plugin_result is not None:
        return plugin_result

    normalized, absolute_path = resolve_fs_path(normalized)
    if not os.path.isdir(absolute_path):
        raise FileNotFoundError(f'Directory not found: {normalized or "/"}')

    entries = []
    for name in sorted(os.listdir(absolute_path), key=lambda value: value.lower()):
        item_abs = os.path.join(absolute_path, name)
        item_rel = '/'.join(filter(None, [normalized, name]))
        entry = {
            'name': name,
            'path': item_rel,
            'type': 'directory' if os.path.isdir(item_abs) else 'file'
        }

        mapped_entry = plugin_manager.call_hook('map_host_entry', entry, item_abs)
        entries.append(mapped_entry if isinstance(mapped_entry, dict) else entry)

    entries.sort(key=lambda item: (item['type'] != 'directory', item['name'].lower()))
    return {
        'path': normalized,
        'entries': entries
    }


def read_fs_file(path_value):
    normalized = normalize_virtual_path(path_value)

    plugin_result = plugin_manager.call_hook('read_file', normalized)
    if plugin_result is not None:
        return plugin_result

    normalized, absolute_path = resolve_fs_path(normalized)
    if not os.path.isfile(absolute_path):
        raise FileNotFoundError(f'File not found: {normalized}')

    with open(absolute_path, 'r', encoding='utf-8') as f:
        return {
            'path': normalized,
            'content': f.read()
        }


def write_fs_file(path_value, content):
    normalized = normalize_virtual_path(path_value)

    plugin_result = plugin_manager.call_hook('write_file', normalized, content)
    if plugin_result is not None:
        return plugin_result

    normalized, absolute_path = resolve_fs_path(normalized)
    if not normalized:
        raise ValueError('Cannot write to root directory')

    os.makedirs(os.path.dirname(absolute_path), exist_ok=True)
    with open(absolute_path, 'w', encoding='utf-8') as f:
        f.write(str(content))

    return {'path': normalized}


def create_fs_directory(path_value):
    normalized = normalize_virtual_path(path_value)

    plugin_result = plugin_manager.call_hook('make_directory', normalized)
    if plugin_result is not None:
        return plugin_result

    normalized, absolute_path = resolve_fs_path(normalized)
    if not normalized:
        raise ValueError('Cannot create root directory')

    os.makedirs(absolute_path, exist_ok=True)
    return {'path': normalized}


plugin_manager.initialize(
    current_dir,
    files_root,
    runtime_context={
        'resolve_fs_path': resolve_fs_path,
        'normalize_virtual_path': normalize_virtual_path
    }
)


def discover_start_menu_items():
    pattern = re.compile(r"\b(?:const|let|var)\s+start_titel\s*=\s*['\"]([^'\"]+)['\"]")
    roots = [
        ('apps', 'app'),
        ('settings', 'settings')
    ]

    items = []

    for root_name, item_type in roots:
        root_path = os.path.join(current_dir, root_name)
        if not os.path.isdir(root_path):
            continue

        for dirpath, _, filenames in os.walk(root_path):
            for filename in filenames:
                if not filename.lower().endswith('.html'):
                    continue

                file_path = os.path.join(dirpath, filename)
                try:
                    with open(file_path, 'r', encoding='utf-8') as f:
                        content = f.read()
                except Exception:
                    continue

                match = pattern.search(content)
                if not match:
                    continue

                start_title = match.group(1).strip()
                if not start_title:
                    continue

                rel_path = os.path.relpath(file_path, current_dir).replace(os.sep, '/')
                items.append({
                    'title': start_title,
                    'url': rel_path,
                    'type': item_type
                })

    items.sort(key=lambda item: (item['type'], item['title'].lower()))
    return items


def trigger_exit():
    def _shutdown():
        global httpd_instance

        try:
            if webview_window is not None:
                webview_window.destroy()
        except Exception:
            pass

        if httpd_instance is not None:
            try:
                httpd_instance.shutdown()
            except Exception:
                pass

    threading.Thread(target=_shutdown, daemon=True).start()

class MyRequestHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=current_dir, **kwargs)

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        request_path = parsed.path
        query_params = urllib.parse.parse_qs(parsed.query)

        # Hvis root, så server index.html
        if request_path in ('/', '/index.html'):
            self.path = '/index.html'
        elif request_path == '/settings/discover':
            try:
                files = discover_settings_json_files()
                self.send_response(200)
                self.send_header('Content-type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps({'files': files}, ensure_ascii=False).encode('utf-8'))
            except Exception as e:
                self.send_response(500)
                self.send_header('Content-type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps({'error': str(e)}).encode('utf-8'))
            return
        elif request_path == '/settings/read':
            settings_path = (query_params.get('path') or [''])[0]
            try:
                payload = read_settings_json(settings_path)
                self.send_response(200)
                self.send_header('Content-type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps(payload, ensure_ascii=False).encode('utf-8'))
            except Exception as e:
                self.send_response(400)
                self.send_header('Content-type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps({'error': str(e)}).encode('utf-8'))
            return
        elif request_path == '/fs/list':
            request_target = (query_params.get('path') or [''])[0]
            try:
                response = list_fs_entries(request_target)
                self.send_response(200)
                self.send_header('Content-type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps(response, ensure_ascii=False).encode('utf-8'))
            except Exception as e:
                self.send_response(400)
                self.send_header('Content-type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps({'error': str(e)}).encode('utf-8'))
            return
        elif request_path == '/fs/read':
            request_target = (query_params.get('path') or [''])[0]
            try:
                response = read_fs_file(request_target)
                self.send_response(200)
                self.send_header('Content-type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps(response, ensure_ascii=False).encode('utf-8'))
            except Exception as e:
                self.send_response(400)
                self.send_header('Content-type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps({'error': str(e)}).encode('utf-8'))
            return
        elif request_path == '/plugins/list':
            try:
                plugin_items = plugin_manager.list_plugins()
                self.send_response(200)
                self.send_header('Content-type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps({'plugins': plugin_items}, ensure_ascii=False).encode('utf-8'))
            except Exception as e:
                self.send_response(500)
                self.send_header('Content-type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps({'error': str(e)}).encode('utf-8'))
            return
        elif request_path == '/plugins/packages':
            try:
                package_items = plugin_manager.list_packages()
                self.send_response(200)
                self.send_header('Content-type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps({'packages': package_items}, ensure_ascii=False).encode('utf-8'))
            except Exception as e:
                self.send_response(500)
                self.send_header('Content-type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps({'error': str(e)}).encode('utf-8'))
            return
        elif request_path == '/plugins/extensions':
            target = (query_params.get('target') or [''])[0]
            payload_json = (query_params.get('payload') or ['{}'])[0]
            try:
                payload = json.loads(payload_json)
            except Exception:
                payload = {}

            try:
                extensions = plugin_manager.collect_ui_extensions(target, payload)
                self.send_response(200)
                self.send_header('Content-type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps({'extensions': extensions}, ensure_ascii=False).encode('utf-8'))
            except Exception as e:
                self.send_response(500)
                self.send_header('Content-type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps({'error': str(e)}).encode('utf-8'))
            return
        elif request_path == '/actions/list':
            target = (query_params.get('target') or [''])[0]
            payload_json = (query_params.get('payload') or ['{}'])[0]
            try:
                payload = json.loads(payload_json)
            except Exception:
                payload = {}

            context = {
                'base_dir': current_dir,
                'shortcuts_file': shortcuts_file,
                'files_root': files_root
            }

            try:
                action_list = actions_core.list_actions(target, payload, context)
                self.send_response(200)
                self.send_header('Content-type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps({'actions': action_list}, ensure_ascii=False).encode('utf-8'))
            except Exception as e:
                self.send_response(500)
                self.send_header('Content-type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps({'error': str(e)}).encode('utf-8'))
            return
        elif request_path == '/start-menu-items':
            try:
                items = discover_start_menu_items()
                self.send_response(200)
                self.send_header('Content-type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()

                response = {'items': items}
                self.wfile.write(json.dumps(response, ensure_ascii=False).encode('utf-8'))
            except Exception as e:
                self.send_response(500)
                self.send_header('Content-type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps({'error': str(e)}).encode('utf-8'))
            return
        # Handle favicon request
        elif request_path == '/favicon.ico':
            self.send_response(204)  # No Content
            self.end_headers()
            return

        self.path = request_path
        return super().do_GET()
    
    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        request_path = parsed.path

        # Handle settings updates
        if request_path == '/update-settings':
            try:
                # Read the request body
                content_length = int(self.headers['Content-Length'])
                post_data = self.rfile.read(content_length)
                
                # Parse JSON data
                settings_data = json.loads(post_data.decode('utf-8'))
                
                # Path to settings file
                settings_file = os.path.join(current_dir, 'data', 'os-settings.json')

                current_settings = {}
                if os.path.isfile(settings_file):
                    try:
                        with open(settings_file, 'r', encoding='utf-8') as f:
                            current_settings = json.load(f)
                    except Exception:
                        current_settings = {}

                # Support both legacy flat JSON and wrapped { settings, settingsMeta } format.
                if isinstance(current_settings, dict) and isinstance(current_settings.get('settings'), dict):
                    current_settings['settings'].update(settings_data)
                    to_save = current_settings
                else:
                    if isinstance(current_settings, dict):
                        current_settings.update(settings_data)
                        to_save = current_settings
                    else:
                        to_save = settings_data
                
                # Write to settings file
                with open(settings_file, 'w', encoding='utf-8') as f:
                    json.dump(to_save, f, indent=2, ensure_ascii=False)
                
                # Send success response
                self.send_response(200)
                self.send_header('Content-type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.send_header('Access-Control-Allow-Methods', 'POST')
                self.send_header('Access-Control-Allow-Headers', 'Content-Type')
                self.end_headers()
                
                response = {"status": "success", "message": "Settings updated successfully"}
                self.wfile.write(json.dumps(response).encode('utf-8'))
                
            except Exception as e:
                # Send error response
                self.send_response(500)
                self.send_header('Content-type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                
                response = {"status": "error", "message": str(e)}
                self.wfile.write(json.dumps(response).encode('utf-8'))
        elif request_path == '/settings/save':
            try:
                content_length = int(self.headers['Content-Length'])
                post_data = self.rfile.read(content_length)
                request_data = json.loads(post_data.decode('utf-8'))

                path_value = request_data.get('path', '')
                data = request_data.get('data', {})
                payload = write_settings_json(path_value, data)

                self.send_response(200)
                self.send_header('Content-type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.send_header('Access-Control-Allow-Methods', 'POST')
                self.send_header('Access-Control-Allow-Headers', 'Content-Type')
                self.end_headers()
                self.wfile.write(json.dumps({'status': 'success', **payload}, ensure_ascii=False).encode('utf-8'))
            except Exception as e:
                self.send_response(400)
                self.send_header('Content-type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps({'status': 'error', 'message': str(e)}).encode('utf-8'))
        elif request_path == '/update-shortcuts':
            try:
                content_length = int(self.headers['Content-Length'])
                post_data = self.rfile.read(content_length)

                shortcuts_data = json.loads(post_data.decode('utf-8'))
                shortcuts_file_path = os.path.join(current_dir, 'data', 'shortcuts.json')

                with open(shortcuts_file_path, 'w', encoding='utf-8') as f:
                    json.dump(shortcuts_data, f, indent=2, ensure_ascii=False)

                self.send_response(200)
                self.send_header('Content-type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.send_header('Access-Control-Allow-Methods', 'POST')
                self.send_header('Access-Control-Allow-Headers', 'Content-Type')
                self.end_headers()

                response = {"status": "success", "message": "Shortcuts updated successfully"}
                self.wfile.write(json.dumps(response).encode('utf-8'))
            except Exception as e:
                self.send_response(500)
                self.send_header('Content-type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()

                response = {"status": "error", "message": str(e)}
                self.wfile.write(json.dumps(response).encode('utf-8'))
        elif request_path == '/exit-js-os':
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps({'status': 'success'}).encode('utf-8'))
            trigger_exit()
        elif request_path == '/actions/execute':
            try:
                content_length = int(self.headers['Content-Length'])
                post_data = self.rfile.read(content_length)
                request_data = json.loads(post_data.decode('utf-8'))

                target = request_data.get('target', '')
                action_id = request_data.get('action', '')
                payload = request_data.get('payload', {})
                if not isinstance(payload, dict):
                    payload = {}

                context = {
                    'base_dir': current_dir,
                    'shortcuts_file': shortcuts_file,
                    'files_root': files_root
                }

                result = actions_core.execute_action(target, action_id, payload, context)
                status_code = 200 if result.get('status') == 'success' else 400

                self.send_response(status_code)
                self.send_header('Content-type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps(result, ensure_ascii=False).encode('utf-8'))
            except Exception as e:
                self.send_response(500)
                self.send_header('Content-type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps({'status': 'error', 'message': str(e)}).encode('utf-8'))
        elif request_path == '/fs/write':
            try:
                content_length = int(self.headers['Content-Length'])
                post_data = self.rfile.read(content_length)
                request_data = json.loads(post_data.decode('utf-8'))

                response = write_fs_file(request_data.get('path', ''), request_data.get('content', ''))
                self.send_response(200)
                self.send_header('Content-type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps({'status': 'success', **response}, ensure_ascii=False).encode('utf-8'))
            except Exception as e:
                self.send_response(400)
                self.send_header('Content-type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps({'status': 'error', 'message': str(e)}).encode('utf-8'))
        elif request_path == '/fs/mkdir':
            try:
                content_length = int(self.headers['Content-Length'])
                post_data = self.rfile.read(content_length)
                request_data = json.loads(post_data.decode('utf-8'))

                response = create_fs_directory(request_data.get('path', ''))
                self.send_response(200)
                self.send_header('Content-type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps({'status': 'success', **response}, ensure_ascii=False).encode('utf-8'))
            except Exception as e:
                self.send_response(400)
                self.send_header('Content-type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps({'status': 'error', 'message': str(e)}).encode('utf-8'))
        elif request_path == '/plugins/enable':
            try:
                content_length = int(self.headers['Content-Length'])
                post_data = self.rfile.read(content_length)
                request_data = json.loads(post_data.decode('utf-8'))

                plugin_id = str(request_data.get('id', '')).strip()
                enabled = bool(request_data.get('enabled', False))
                response = plugin_manager.set_plugin_enabled(plugin_id, enabled)

                self.send_response(200)
                self.send_header('Content-type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps({'status': 'success', **response}, ensure_ascii=False).encode('utf-8'))
            except Exception as e:
                self.send_response(400)
                self.send_header('Content-type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps({'status': 'error', 'message': str(e)}).encode('utf-8'))
        elif request_path == '/plugins/install':
            try:
                content_length = int(self.headers['Content-Length'])
                post_data = self.rfile.read(content_length)
                request_data = json.loads(post_data.decode('utf-8'))

                package_id = str(request_data.get('packageId', '')).strip()
                response = plugin_manager.install_package(package_id, update=False)

                self.send_response(200)
                self.send_header('Content-type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps({'status': 'success', **response}, ensure_ascii=False).encode('utf-8'))
            except Exception as e:
                self.send_response(400)
                self.send_header('Content-type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps({'status': 'error', 'message': str(e)}).encode('utf-8'))
        elif request_path == '/plugins/update':
            try:
                content_length = int(self.headers['Content-Length'])
                post_data = self.rfile.read(content_length)
                request_data = json.loads(post_data.decode('utf-8'))

                package_id = str(request_data.get('packageId', '')).strip()
                response = plugin_manager.install_package(package_id, update=True)

                self.send_response(200)
                self.send_header('Content-type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps({'status': 'success', **response}, ensure_ascii=False).encode('utf-8'))
            except Exception as e:
                self.send_response(400)
                self.send_header('Content-type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps({'status': 'error', 'message': str(e)}).encode('utf-8'))
        elif request_path == '/plugins/uninstall':
            try:
                content_length = int(self.headers['Content-Length'])
                post_data = self.rfile.read(content_length)
                request_data = json.loads(post_data.decode('utf-8'))

                package_id = str(request_data.get('packageId', '')).strip()
                response = plugin_manager.uninstall_package(package_id)

                self.send_response(200)
                self.send_header('Content-type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps({'status': 'success', **response}, ensure_ascii=False).encode('utf-8'))
            except Exception as e:
                self.send_response(400)
                self.send_header('Content-type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps({'status': 'error', 'message': str(e)}).encode('utf-8'))
        elif request_path == '/plugins/execute':
            try:
                content_length = int(self.headers['Content-Length'])
                post_data = self.rfile.read(content_length)
                request_data = json.loads(post_data.decode('utf-8'))

                action_id = str(request_data.get('actionId', '')).strip()
                payload = request_data.get('payload', {})
                if not isinstance(payload, dict):
                    payload = {}

                result = plugin_manager.execute_plugin_action(action_id, payload)

                self.send_response(200)
                self.send_header('Content-type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps({'status': 'success', **(result if isinstance(result, dict) else {})}, ensure_ascii=False).encode('utf-8'))
            except Exception as e:
                self.send_response(400)
                self.send_header('Content-type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps({'status': 'error', 'message': str(e)}).encode('utf-8'))
        else:
            self.send_response(404)
            self.end_headers()
    
    def do_OPTIONS(self):
        # Handle CORS preflight requests
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()


class ReusableTCPServer(socketserver.TCPServer):
    allow_reuse_address = True


def start_http_server():
    global httpd_instance

    with ReusableTCPServer(('', PORT), MyRequestHandler) as httpd:
        httpd_instance = httpd
        print(f'Server started on port {PORT}')
        print(f'Åbn http://localhost:{PORT} i din browser')
        httpd.serve_forever()


if __name__ == '__main__':
    if webview is None:
        print('pywebview ikke installeret. Kør: pip install pywebview')
        start_http_server()
    else:
        server_thread = threading.Thread(target=start_http_server, daemon=True)
        server_thread.start()

        time.sleep(0.4)
        webview_window = webview.create_window(
            'JS-OS',
            f'http://localhost:{PORT}',
            fullscreen=True,
            frameless=True,
            easy_drag=False
        )
        webview.start()

        if httpd_instance is not None:
            try:
                httpd_instance.shutdown()
            except Exception:
                pass