"""Backend sync tests without camera/GPU dependencies or network access."""
import ast
from pathlib import Path
import threading
import time
import unittest
from types import SimpleNamespace

source = Path(__file__).resolve().parents[1] / 'people_counting.py'
module = ast.parse(source.read_text())
node = next(n for n in module.body if isinstance(n, ast.ClassDef) and n.name == 'BackendSync')

class Response:
    ok = True
    def __init__(self, data): self.data = data
    def json(self): return self.data

class SyncTests(unittest.TestCase):
    def setUp(self):
        self.calls = []
        self.stats = []
        def get(url, **kwargs):
            self.calls.append(('GET', url, kwargs))
            return Response({'data': self.stats})
        def post(url, **kwargs):
            self.calls.append(('POST', url, kwargs))
            return Response({})
        namespace = {'threading': threading, 'time': time, 'DEVICE_TOKEN': 'test-device-token', 'SYNC_INTERVAL': 5,
                     'requests': SimpleNamespace(get=get, post=post, exceptions=SimpleNamespace(RequestException=ConnectionError))}
        exec(compile(ast.Module(body=[node], type_ignores=[]), str(source), 'exec'), namespace)
        self.sync = namespace['BackendSync']('box-1', 'https://example.invalid/api')

    def test_missing_camera_frame_is_not_reported_as_zero(self):
        self.sync._send_count()
        self.assertEqual(self.calls, [])
        self.assertFalse(self.sync.connected)

    def test_counts_are_authenticated_and_scoped(self):
        self.sync.update_count(3)
        self.sync._send_count()
        method, url, options = self.calls[0]
        self.assertEqual(method, 'POST')
        self.assertEqual(options['headers']['X-Device-Token'], 'test-device-token')
        self.assertEqual(options['json']['id_box'], 'box-1')
        self.assertEqual(options['json']['detected_count'], 3)

    def test_stale_camera_count_is_not_republished(self):
        self.sync.update_count(3)
        self.sync.last_detection = time.monotonic() - 11
        self.sync._send_count()
        self.assertEqual(self.calls, [])

    def test_closed_session_does_not_reuse_previous_session(self):
        self.sync.session_id = 99
        self.sync.registered_count = 5
        self.sync._get_session_from_backend()
        self.assertIsNone(self.sync.session_id)
        self.assertEqual(self.sync.registered_count, 0)
        self.assertEqual(self.calls[0][2]['params'], {'id_box': 'box-1'})

    def test_registered_count_uses_current_queue_not_all_historical_badges(self):
        self.stats = [{'session_id': 5, 'active_users': '2', 'unique_users': 8}]
        self.sync._get_session_from_backend()
        self.assertEqual(self.sync.session_id, 5)
        self.assertEqual(self.sync.registered_count, 2)

if __name__ == '__main__': unittest.main()
