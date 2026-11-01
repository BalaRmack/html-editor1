#!/usr/bin/env python3
"""SkyLauncher dev server.
Serves the launcher web app so it can be previewed in a browser.
Run:  python3 server.py
"""
import http.server
import socketserver
import os
import webbrowser
import threading

PORT = 8765
ROOT = os.path.dirname(os.path.abspath(__file__))


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        # allow local preview iframes / caching control
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


def main():
    os.chdir(ROOT)
    with socketserver.TCPServer(("0.0.0.0", PORT), Handler) as httpd:
        print(f"SkyLauncher dev server: http://localhost:{PORT}/")
        print("Serving", ROOT)
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nStopped.")


if __name__ == "__main__":
    main()
