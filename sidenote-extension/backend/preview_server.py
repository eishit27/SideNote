#!/usr/bin/env python3
"""Serve only the standalone SideNote preview over loopback HTTP."""
from __future__ import annotations

import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
HOST = "127.0.0.1"
PORT = int(os.environ.get("SIDENOTE_STATIC_PORT", "8765"))
ALLOWED_HOSTS = {"localhost", "127.0.0.1", "::1"}
ALLOWED_FILES = {
    "/preview.html": ("preview.html", "text/html; charset=utf-8"),
    "/outreach/SideNote_Demo.mp4": ("outreach/SideNote_Demo.mp4", "video/mp4"),
    # Preserve URLs already used by the demo's existing browser tabs.
    "/sidenote-extension/outreach/SideNote_Demo.mp4": ("outreach/SideNote_Demo.mp4", "video/mp4"),
}


class PreviewHandler(BaseHTTPRequestHandler):
    server_version = "SideNotePreview/1.0"
    sys_version = ""

    def respond(self, include_body: bool) -> None:
        try:
            host = urlsplit(f"//{self.headers.get('Host', '')}").hostname
        except ValueError:
            self.send_error(400, "Invalid Host header")
            return
        path = urlsplit(self.path).path
        if host not in ALLOWED_HOSTS:
            self.send_error(403, "Loopback Host header required")
            return
        if path == "/":
            path = "/preview.html"
        if path not in ALLOWED_FILES:
            self.send_error(404, "Not found")
            return

        filename, content_type = ALLOWED_FILES[path]
        file_path = ROOT / filename
        file_size = file_path.stat().st_size
        start = 0
        end = file_size - 1
        status = 200
        range_header = self.headers.get("Range") if content_type == "video/mp4" else None
        if range_header:
            try:
                unit, value = range_header.split("=", 1)
                first, last = value.split("-", 1)
                if unit != "bytes" or "," in value or not file_size:
                    raise ValueError
                if first:
                    start = int(first)
                    end = min(int(last), file_size - 1) if last else file_size - 1
                else:
                    suffix_length = int(last)
                    if suffix_length <= 0:
                        raise ValueError
                    start = max(0, file_size - suffix_length)
                if start < 0 or end < start or start >= file_size:
                    raise ValueError
                status = 206
            except (ValueError, TypeError):
                self.send_response(416)
                self.send_header("Content-Range", f"bytes */{file_size}")
                self.send_header("Accept-Ranges", "bytes")
                self.send_header("Content-Length", "0")
                self.end_headers()
                return

        content_length = end - start + 1
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(content_length))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        if content_type == "video/mp4":
            self.send_header("Accept-Ranges", "bytes")
            if status == 206:
                self.send_header("Content-Range", f"bytes {start}-{end}/{file_size}")
        if path == "/preview.html":
            api_port = os.environ.get("SIDENOTE_PORT", "8766")
            if not api_port.isdigit() or not 1024 <= int(api_port) <= 65535:
                raise RuntimeError("SIDENOTE_PORT must be between 1024 and 65535.")
            csp = (
                "default-src 'none'; "
                "script-src 'unsafe-inline'; "
                "style-src 'unsafe-inline'; "
                f"connect-src http://127.0.0.1:{api_port}; "
                "base-uri 'none'; object-src 'none'; form-action 'none'; frame-ancestors 'none'"
            )
            self.send_header("Content-Security-Policy", csp)
            self.send_header("X-Frame-Options", "DENY")
        self.end_headers()
        if include_body:
            with file_path.open("rb") as source:
                source.seek(start)
                remaining = content_length
                while remaining:
                    chunk = source.read(min(64 * 1024, remaining))
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    remaining -= len(chunk)

    def do_GET(self) -> None:
        self.respond(include_body=True)

    def do_HEAD(self) -> None:
        self.respond(include_body=False)

    def log_message(self, fmt: str, *args: object) -> None:
        path = urlsplit(self.path).path
        print(f"{self.log_date_time_string()} {self.address_string()} {self.command} {path}")


if __name__ == "__main__":
    if not 1024 <= PORT <= 65535:
        raise SystemExit("SIDENOTE_STATIC_PORT must be between 1024 and 65535.")
    print(f"SideNote preview listening on http://127.0.0.1:{PORT}/preview.html")
    ThreadingHTTPServer((HOST, PORT), PreviewHandler).serve_forever()
