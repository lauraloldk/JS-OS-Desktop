import http.server
import socketserver
import os
import json
import urllib.parse

PORT = 8000

# Find den mappe hvor denne fil ligger
current_dir = os.path.dirname(os.path.abspath(__file__))

class MyRequestHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=current_dir, **kwargs)

    def do_GET(self):
        # Hvis root, så server index.html
        if self.path in ('/', '/index.html'):
            self.path = '/index.html'
        # Handle favicon request
        elif self.path == '/favicon.ico':
            self.send_response(204)  # No Content
            self.end_headers()
            return
        return super().do_GET()
    
    def do_POST(self):
        # Handle settings updates
        if self.path == '/update-settings':
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
        else:
            self.send_response(404)
            self.end_headers()
    
    def do_OPTIONS(self):
        # Handle CORS preflight requests
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

with socketserver.TCPServer(('', PORT), MyRequestHandler) as httpd:
    print(f'Server started on port {PORT}')
    print(f'Åbn http://localhost:{PORT} i din browser')
    httpd.serve_forever()