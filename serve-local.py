# Local web server for Pedal Playground. Unlike "python -m http.server" it tells the
# browser to check for changed files on every load, so edits show up without a hard refresh.
import functools
import http.server
import os
import sys


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()


port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
root = os.path.dirname(os.path.abspath(__file__))
print("Serving Pedal Playground at http://localhost:%d/ (Ctrl+C to stop)" % port)
http.server.ThreadingHTTPServer(("", port), functools.partial(NoCacheHandler, directory=root)).serve_forever()
