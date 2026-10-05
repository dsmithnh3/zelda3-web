#!/usr/bin/env python3
"""Threaded static server for out/web, plus three endpoints the browser test
needs.  Local only; nothing here ships to users.

  GET  /_rom      the staged ROM, so the harness can hand the real page a real
                  File without a human clicking a file dialog
  GET  /_script   tests/play-newgame.txt, so the browser runs the SAME input
                  script as the native harness
  GET  /_script2  tests/reload-loadsave.txt, the after-reload script
  POST /_result   the harness posts its JSON result and canvas PNGs here
"""
import argparse
import base64
import http.server
import json
import pathlib
import socketserver
import sys
import threading

ROOT = pathlib.Path(__file__).resolve().parent.parent
WEB = ROOT / 'out' / 'web'
ROM = pathlib.Path.home() / 'decompfleet' / 'roms' / 'zelda3.sfc'
RESULT_DIR = ROOT / 'out' / 'browsercheck'

done = threading.Event()
result_holder = {}


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=str(WEB), **kw)

    def log_message(self, fmt, *args):
        if '--verbose' in sys.argv:
            super().log_message(fmt, *args)

    def end_headers(self):
        # Keep the browser from serving a stale wasm between build iterations.
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def do_GET(self):
        if self.path == '/_rom':
            if not ROM.exists():
                self.send_error(404, 'ROM not staged')
                return
            data = ROM.read_bytes()
            self.send_response(200)
            self.send_header('Content-Type', 'application/octet-stream')
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        if self.path in ('/_script', '/_script2'):
            name = 'play-newgame.txt' if self.path == '/_script' else 'reload-loadsave.txt'
            data = (ROOT / 'tests' / name).read_bytes()
            self.send_response(200)
            self.send_header('Content-Type', 'text/plain')
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        super().do_GET()

    def do_POST(self):
        if self.path != '/_result':
            self.send_error(404)
            return
        n = int(self.headers.get('Content-Length', 0))
        payload = json.loads(self.rfile.read(n).decode('utf8'))
        RESULT_DIR.mkdir(parents=True, exist_ok=True)
        shots = payload.pop('shots', {})
        for name, data_url in shots.items():
            b64 = data_url.split(',', 1)[1]
            (RESULT_DIR / f'{name}.png').write_bytes(base64.b64decode(b64))
        (RESULT_DIR / 'result.json').write_text(json.dumps(payload, indent=2) + '\n')
        result_holder.update(payload)
        self.send_response(204)
        self.end_headers()
        done.set()


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--port', type=int, default=8731)
    ap.add_argument('--verbose', action='store_true')
    args = ap.parse_args()
    with Server(('127.0.0.1', args.port), Handler) as httpd:
        print(f'serving {WEB} on http://127.0.0.1:{args.port}/', flush=True)
        httpd.serve_forever()


if __name__ == '__main__':
    main()
