"""本機網站伺服器：不快取（改了檔案重新整理就看得到）、正確的 MIME（.vtt、.mjs）、支援影片拖曳（Range）

用法：python tools/serve.py [port]（預設 8790，根目錄是 site/）
"""
import http.server, os, re, sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "site")
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8790


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map,
                      ".js": "text/javascript", ".mjs": "text/javascript", ".vtt": "text/vtt; charset=utf-8",
                      ".json": "application/json", ".wasm": "application/wasm", ".mp4": "video/mp4", ".bin": "application/octet-stream"}

    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Accept-Ranges", "bytes")
        super().end_headers()

    def log_message(self, fmt, *args):
        pass

    def send_head(self):
        rng = self.headers.get("Range")
        path = self.translate_path(self.path)
        if not rng or not os.path.isfile(path):
            return super().send_head()
        m = re.match(r"bytes=(\d*)-(\d*)", rng)
        size = os.path.getsize(path)
        start = int(m.group(1)) if m and m.group(1) else 0
        end = int(m.group(2)) if m and m.group(2) else size - 1
        end = min(end, size - 1)
        if start > end:
            self.send_error(416); return None
        f = open(path, "rb"); f.seek(start)
        self.send_response(206)
        self.send_header("Content-Type", self.guess_type(path))
        self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.send_header("Content-Length", str(end - start + 1))
        self.end_headers()
        self._range_left = end - start + 1
        return f

    def copyfile(self, source, outputfile):
        left = getattr(self, "_range_left", None)
        if left is None:
            return super().copyfile(source, outputfile)
        try:
            while left > 0:
                buf = source.read(min(65536, left))
                if not buf: break
                outputfile.write(buf); left -= len(buf)
        except (ConnectionResetError, BrokenPipeError):
            pass


if __name__ == "__main__":
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"水文學：http://127.0.0.1:{PORT}/　（關閉這個視窗就停止）")
    srv.serve_forever()
