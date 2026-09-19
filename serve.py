#!/usr/bin/env python3
"""Local dev server with caching turned off.

`python3 -m http.server` sends Last-Modified and browsers happily serve a stale
css/js from memory cache without revalidating — so an edit to viz-kit.js appears
not to have taken effect, which is a genuinely confusing hour to lose.

    python3 serve.py [port]        # default 8000
"""
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class NoCache(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def log_message(self, fmt, *args):
        pass


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    print(f"serving {__file__.rsplit('/', 1)[0]} on http://localhost:{port}  (no-cache)")
    ThreadingHTTPServer(("", port), NoCache).serve_forever()
