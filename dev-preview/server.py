"""Local, synthetic CommPilot preview. No requests reach a BroadWorks server."""

from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse
import mimetypes

ROOT = Path(__file__).resolve().parents[1]
PORT = 8765
SOURCE_FILES = [
    ROOT / "src/content/pjax.js",
    ROOT / "src/content/enhancer.js",
    ROOT / "src/content/enhancer.css",
    ROOT / "src/content/native-pjax.css",
    ROOT / "dev-preview/index.html",
]


class Handler(BaseHTTPRequestHandler):
    def send_bytes(self, data: bytes, mime: str, status: int = 200):
        self.send_response(status)
        self.send_header("Content-Type", mime)
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def page(self):
        self.send_bytes((ROOT / "dev-preview/index.html").read_bytes(), "text/html; charset=utf-8")

    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/version":
            version = str(max(f.stat().st_mtime_ns for f in SOURCE_FILES)).encode()
            return self.send_bytes(version, "text/plain")
        files = {
            "/site.css": ROOT / "Testing HTML Files/Groups_files/styles(1).css",
            "/base.css": ROOT / "Testing HTML Files/Groups_files/styles.css",
            "/src/content/pjax.js": ROOT / "src/content/pjax.js",
            "/src/content/enhancer.js": ROOT / "src/content/enhancer.js",
            "/src/content/enhancer.css": ROOT / "src/content/enhancer.css",
            "/src/content/native-pjax.css": ROOT / "src/content/native-pjax.css",
        }
        if path in files:
            file = files[path]
            return self.send_bytes(file.read_bytes(), mimetypes.guess_type(str(file))[0] or "text/plain")
        if path == "/" or path == "/preview" or path.startswith("/commpilot/"):
            return self.page()
        self.send_error(404)

    def do_POST(self):
        length = int(self.headers.get("Content-Length", "0"))
        self.rfile.read(length)
        self.page()


if __name__ == "__main__":
    print(f"Local preview: http://127.0.0.1:{PORT}/preview", flush=True)
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
