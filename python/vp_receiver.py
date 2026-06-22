"""
vp_receiver.py: lets the Scripture Panel on another laptop drive this
laptop's VideoPsalm, so one keypress puts a verse on both the stream and the
projector.

Runs on the projection laptop next to VideoPsalm. It listens on the church
network and accepts the same commands as videopsalm_bridge.py's daemon
(check, send, bibles, set-bible, press), each as one JSON POST to /command.
Every request must carry the shared key in an "X-Receiver-Key" header; the key
is made on first run, saved next to this program and shown in its window, to
be copied into the panel's Settings.

Usage:
    python vp_receiver.py            # or the packaged vp_receiver.exe
    python vp_receiver.py --port 8765
"""
import argparse
import json
import os
import secrets
import socket
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer

import videopsalm_bridge as bridge

PORT = 8765


def here():
    """Folder of the program: next to the .exe when packaged."""
    return os.path.dirname(sys.executable if getattr(sys, 'frozen', False) else os.path.abspath(__file__))


def load_key():
    path = os.path.join(here(), 'vp_receiver.json')
    try:
        with open(path, encoding='utf-8') as f:
            return json.load(f)['key']
    except Exception:
        key = secrets.token_hex(8)
        with open(path, 'w', encoding='utf-8') as f:
            json.dump({'key': key}, f)
        return key


def run_command(cmd):
    """One command, answered exactly as the bridge daemon answers it."""
    action = cmd.get('action')
    if action == 'check':
        return {'running': bridge.is_running()}
    try:
        if action == 'send':
            return json.loads(bridge.result_json(*bridge.send_reference(cmd.get('reference', ''))))
        if action == 'bibles':
            return json.loads(bridge.result_json(*bridge.list_bibles(), key='result'))
        if action == 'set-bible':
            return json.loads(bridge.result_json(*bridge.set_bible(cmd.get('name', '')), key='result'))
        if action == 'press':
            return json.loads(bridge.result_json(*bridge.press_screen_button(cmd.get('button', '')), key='result'))
    except Exception as exc:
        return {'ok': False, 'error': str(exc)}
    return {'ok': False, 'error': f'Unknown action: {action}'}


class Handler(BaseHTTPRequestHandler):
    key = ''

    def _answer(self, status, body):
        data = json.dumps(body).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self):
        if self.path != '/command':
            return self._answer(404, {'ok': False, 'error': 'Not found'})
        if not secrets.compare_digest(self.headers.get('X-Receiver-Key', ''), self.key):
            return self._answer(403, {'ok': False, 'error': 'Wrong receiver key'})
        try:
            length = min(int(self.headers.get('Content-Length', 0)), 10_000)
            cmd = json.loads(self.rfile.read(length) or b'{}')
        except ValueError:
            return self._answer(400, {'ok': False, 'error': 'Bad JSON'})
        result = run_command(cmd)
        if cmd.get('action') != 'check':
            print(f"{cmd.get('action')} {cmd.get('reference') or cmd.get('name') or cmd.get('button') or ''}"
                  f" -> {'ok' if result.get('ok') else result.get('error')}", flush=True)
        self._answer(200, result)

    def log_message(self, *args):   # quiet: only the commands above are printed
        pass


def local_addresses():
    try:
        names = socket.gethostbyname_ex(socket.gethostname())[2]
        return [a for a in names if not a.startswith('127.')]
    except OSError:
        return []


def main():
    p = argparse.ArgumentParser(description='Receive verses from the Scripture Panel for this VideoPsalm.')
    p.add_argument('--port', type=int, default=PORT)
    args = p.parse_args()

    Handler.key = load_key()
    # One thread on purpose: VideoPsalm is driven through UI Automation, which
    # wants every call from the same thread, and commands arrive one at a time.
    server = HTTPServer(('0.0.0.0', args.port), Handler)
    print('Scripture Panel receiver for VideoPsalm')
    print('In the Scripture Panel, open Settings and enter:')
    for addr in local_addresses() or ['<this laptop\'s address>']:
        print(f'   Projection laptop address:  {addr}:{args.port}')
    print(f'   Receiver key:               {Handler.key}')
    print('VideoPsalm', 'is open.' if bridge.is_running() else 'is not open yet. Open it before the service.')
    print('Leave this window open during the service. Close it to stop.\n', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == '__main__':
    main()
