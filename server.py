import http.server
import socketserver
import os
import json
import urllib.parse
import threading
import re
import time
import importlib
import actions as actions_core

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
    normalized = normalize_virtual_path(path_value)
    absolute_path = os.path.abspath(os.path.join(files_root, normalized))

    root_abs = os.path.abspath(files_root)
    if absolute_path != root_abs and not absolute_path.startswith(root_abs + os.sep):
        raise ValueError('Path escapes files root')

    return normalized, absolute_path


def list_fs_entries(path_value=''):
    normalized, absolute_path = resolve_fs_path(path_value)
    if not os.path.isdir(absolute_path):
        raise FileNotFoundError(f'Directory not found: {normalized or "/"}')

    entries = []
    for name in sorted(os.listdir(absolute_path), key=lambda value: value.lower()):
        item_abs = os.path.join(absolute_path, name)
        item_rel = '/'.join(filter(None, [normalized, name]))
        entries.append({
            'name': name,
            'path': item_rel,
            'type': 'directory' if os.path.isdir(item_abs) else 'file'
        })

    entries.sort(key=lambda item: (item['type'] != 'directory', item['name'].lower()))
    return {
        'path': normalized,
        'entries': entries
    }


def read_fs_file(path_value):
    normalized, absolute_path = resolve_fs_path(path_value)
    if not os.path.isfile(absolute_path):
        raise FileNotFoundError(f'File not found: {normalized}')

    with open(absolute_path, 'r', encoding='utf-8') as f:
        return {
            'path': normalized,
            'content': f.read()
        }


def write_fs_file(path_value, content):
    normalized, absolute_path = resolve_fs_path(path_value)
    if not normalized:
        raise ValueError('Cannot write to root directory')

    os.makedirs(os.path.dirname(absolute_path), exist_ok=True)
    with open(absolute_path, 'w', encoding='utf-8') as f:
        f.write(str(content))

    return {'path': normalized}


def create_fs_directory(path_value):
    normalized, absolute_path = resolve_fs_path(path_value)
    if not normalized:
        raise ValueError('Cannot create root directory')

    os.makedirs(absolute_path, exist_ok=True)
    return {'path': normalized}


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
                
                # Write to settings file
                with open(settings_file, 'w', encoding='utf-8') as f:
                    json.dump(settings_data, f, indent=2, ensure_ascii=False)
                
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