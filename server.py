# -*- coding: utf-8 -*-
"""Local HTTP server for PlanX Urban Procedural 3D.

Serves the Web UI static files and routes sync POST requests back to QGIS.
"""
from __future__ import annotations

import json
import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import threading

class SyncHTTPRequestHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        try:
            log_file = os.path.join(os.path.dirname(__file__), "server_debug.log")
            with open(log_file, "a", encoding="utf-8") as f:
                f.write(f"[{self.log_date_time_string()}] {self.address_string()} - {format % args}\n")
        except Exception:
            pass

    def end_headers(self):
        # Enable CORS for local testing/development
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        # Prevent caching of static assets and data
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    def do_GET(self):
        # Routing
        url = self.path.split('?')[0]
        
        if url == "/data.geojson":
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            self.wfile.write(self.server.geojson_data.encode('utf-8'))
            return

        # Serve static assets
        clean_path = url.lstrip("/")
        if not clean_path or clean_path == "" or clean_path == "index.html":
            clean_path = "src/index.html"
        elif clean_path == "app.js":
            clean_path = "src/app.js"
        elif clean_path == "style.css":
            clean_path = "src/style.css"
            
        file_path = os.path.join(self.server.web_dir, clean_path)
        
        # Security check: do not escape web_dir (case-insensitive to prevent Windows drive letter mismatch)
        real_web_dir = os.path.realpath(self.server.web_dir).lower()
        real_file_path = os.path.realpath(file_path).lower()
        if not real_file_path.startswith(real_web_dir):
            self.send_error(403, "Access Denied")
            return

        if not os.path.exists(file_path) or os.path.isdir(file_path):
            self.send_error(404, "File Not Found")
            return

        ext = os.path.splitext(file_path)[1].lower()
        mime_types = {
            ".html": "text/html; charset=utf-8",
            ".css": "text/css; charset=utf-8",
            ".js": "application/javascript; charset=utf-8",
            ".png": "image/png",
            ".json": "application/json"
        }
        mime = mime_types.get(ext, "application/octet-stream")

        self.send_response(200)
        self.send_header("Content-Type", mime)
        self.end_headers()
        with open(file_path, 'rb') as f:
            self.wfile.write(f.read())

    def do_POST(self):
        url = self.path.split('?')[0]
        if url == "/sync":
            content_length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_length).decode('utf-8')
            try:
                data = json.loads(body)
                if self.server.sync_callback:
                    # Execute callback in a safe thread-safe manner or direct call
                    success, msg = self.server.sync_callback(data)
                    response_data = {"status": "ok" if success else "error", "message": msg}
                else:
                    response_data = {"status": "error", "message": "No sync callback registered"}
            except Exception as e:
                response_data = {"status": "error", "message": str(e)}

            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            self.wfile.write(json.dumps(response_data).encode('utf-8'))


class PlanXProceduralServer:
    def __init__(self, port: int, web_dir: str, sync_callback=None):
        self.port = port
        self.web_dir = web_dir
        self.sync_callback = sync_callback
        self.geojson_data = "{}"
        self.httpd = None
        self.thread = None

    def start(self):
        # Instantiate ThreadingHTTPServer in the main thread to catch port binding errors immediately
        self.httpd = ThreadingHTTPServer(('127.0.0.1', self.port), SyncHTTPRequestHandler)
        self.httpd.web_dir = self.web_dir
        self.httpd.sync_callback = self.sync_callback
        self.httpd.geojson_data = self.geojson_data

        def serve():
            self.httpd.serve_forever()

        self.thread = threading.Thread(target=serve, daemon=True)
        self.thread.start()

    def update_geojson(self, geojson_str: str):
        self.geojson_data = geojson_str
        if self.httpd:
            self.httpd.geojson_data = geojson_str

    def stop(self):
        if self.httpd:
            self.httpd.shutdown()
            self.httpd.server_close()
            self.httpd = None
        if self.thread:
            self.thread.join(timeout=1.0)
            self.thread = None
