import http.server
import socketserver
import os

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
        return super().do_GET()

with socketserver.TCPServer(('', PORT), MyRequestHandler) as httpd:
    print(f'Server started on port {PORT}')
    print(f'Åbn http://localhost:{PORT} i din browser')
    httpd.serve_forever()