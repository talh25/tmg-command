"""Local server for TMG Command (for testing, or for serving the app to phones on your Wi-Fi).

- HTTPS on 8443 (certs/server.pem, signed by a private CA made on this Mac): the address to
  install the app from, so the iPhone's service worker can save it for offline use.
- HTTP on 8765: the setup page (/setup) and the CA certificate download (/sc-tmg-local-ca.crt),
  plus the app itself as a plain fallback.

Python's default http.server has a listen backlog of 5, which drops connections when an
iPhone opens many requests at once; this uses a larger backlog and threads.
"""
import http.server
import socket
import socketserver
import ssl
import subprocess
import sys
import threading
from pathlib import Path

BASE = Path(__file__).resolve().parent.parent
ROOT = BASE / "site"
CERTS = BASE / "certs"
HTTP_PORT, HTTPS_PORT = 8765, 8443


def host():
    try:
        return subprocess.check_output(["scutil", "--get", "LocalHostName"], text=True).strip() + ".local"
    except Exception:
        return "localhost"


SETUP_PAGE = """<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>SC TMG setup</title><style>body{{font:16px -apple-system,sans-serif;background:#02060B;color:#E8F2FA;padding:20px;line-height:1.45}}
a.b{{display:block;margin:14px 0;padding:14px;border-radius:10px;background:#17405f;border:1px solid #77C7FF;color:#fff;text-align:center;font-weight:700;text-decoration:none}}
li{{margin:8px 0}} b{{color:#8FD6FF}}</style></head><body>
<h2>SC TMG Companion — iPhone setup</h2>
<p><b>Step 1.</b> Download the certificate for this Mac:</p>
<a class="b" href="/sc-tmg-local-ca.crt">Download certificate</a>
<ol><li>Tap <b>Allow</b>, then <b>Close</b>.</li>
<li>Open <b>Settings</b> → <b>Profile Downloaded</b> (near the top) → <b>Install</b>.</li>
<li><b>Settings → General → About → Certificate Trust Settings</b> → turn on the switch for <b>mkcert …</b>.</li></ol>
<p><b>Step 2.</b> Open the app over the secure address:</p>
<a class="b" href="https://{host}:{https}/">Open SC TMG Companion</a>
<ol><li>Tap <b>Share</b> → <b>Add to Home Screen</b> → <b>Add</b>.</li>
<li>Open the app <b>from the Home Screen icon</b>.</li>
<li>Go <b>Settings (⚙)</b> → <b>Download for offline</b> and wait until it says all files are saved.</li></ol>
<p>Done — the app now works on this iPhone with no Mac and no internet.</p></body></html>"""


SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "X-Frame-Options": "SAMEORIGIN",  # the app frames its own Army Builder page only
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
}


class Handler(http.server.SimpleHTTPRequestHandler):
    timeout = 30  # drop clients that stall mid-request instead of holding a thread forever
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".m4a": "audio/mp4", ".webp": "image/webp", ".webmanifest": "application/manifest+json",
        ".js": "text/javascript", ".json": "application/json",
    }

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def do_GET(self):
        path = self.path.split("?")[0]
        if path in ("/setup", "/setup/"):
            body = SETUP_PAGE.format(host=host(), https=HTTPS_PORT).encode()
            return self._send(body, "text/html; charset=utf-8")
        if path == "/sc-tmg-local-ca.crt":
            return self._send((CERTS / "sc-tmg-local-ca.crt").read_bytes(), "application/x-x509-ca-cert")
        return super().do_GET()

    def list_directory(self, path):
        # Never show folder listings; only real files are served.
        self.send_error(404, "Not found")
        return None

    def _send(self, body, ctype):
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def handle(self):
        if getattr(self.server, "tls", False):
            # Handshake here, in the worker thread, so one slow client can't block accept().
            try:
                self.connection.do_handshake()
            except (ssl.SSLError, OSError):
                return
        else:
            # Safari may try HTTPS on the plain-HTTP port first ("HTTPS upgrade"). A TLS
            # ClientHello starts with 0x16: close quietly so Safari falls back to http://.
            try:
                if self.connection.recv(1, socket.MSG_PEEK) == b"\x16":
                    return
            except OSError:
                return
        super().handle()

    def end_headers(self):
        path = getattr(self, "path", "") or ""
        self.send_header("Cache-Control", "public, max-age=604800" if "/media/" in path else "no-cache")
        for k, v in SECURITY_HEADERS.items():
            self.send_header(k, v)
        super().end_headers()

    def log_message(self, fmt, *args):
        pass


class Server(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True
    request_queue_size = 128

    def handle_error(self, request, client_address):
        # Phones drop connections all the time (seeking audio, locking the screen); stay quiet about it.
        exc = sys.exc_info()[1]
        if isinstance(exc, (ConnectionError, ssl.SSLError, TimeoutError)):
            return
        super().handle_error(request, client_address)


def main():
    http_port = int(sys.argv[1]) if len(sys.argv) > 1 else HTTP_PORT
    servers = [Server(("0.0.0.0", http_port), Handler)]
    if (CERTS / "server.pem").exists():
        https = Server(("0.0.0.0", HTTPS_PORT), Handler)
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        ctx.load_cert_chain(CERTS / "server.pem", CERTS / "server-key.pem")
        https.socket = ctx.wrap_socket(https.socket, server_side=True, do_handshake_on_connect=False)
        https.tls = True
        servers.append(https)
    for s in servers[1:]:
        threading.Thread(target=s.serve_forever, daemon=True).start()
    servers[0].serve_forever()


if __name__ == "__main__":
    main()
