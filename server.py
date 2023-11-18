
import http.server
import socketserver

# Set the port number for the server
PORT = 8000

# Define the request handler class
class MyRequestHandler(http.server.SimpleHTTPRequestHandler):
    pass

# Create a TCP server with the specified port and request handler
with socketserver.TCPServer(("", PORT), MyRequestHandler) as httpd:
    print(f"Server started on port {PORT}")
    httpd.serve_forever()
