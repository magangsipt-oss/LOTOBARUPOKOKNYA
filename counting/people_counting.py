import os
import cv2
import numpy as np
import threading
import time
import requests
from io import BytesIO
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from ultralytics import YOLO

# RTSP capture options
os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = "rtsp_transport;udp|fflags;nobuffer|max_delay;0"

# ==============================================================================
# KONFIGURASI
# ==============================================================================
BACKEND_URL = os.environ.get("ELOTO_API_URL", "http://localhost:5002/api")
BOX_ID = os.environ.get("ELOTO_BOX_ID", "BOX ELOTO 1")
HEADLESS = os.environ.get("ELOTO_HEADLESS", "1") == "1"
SYNC_INTERVAL = max(2, int(os.environ.get("ELOTO_SYNC_INTERVAL", "5")))
RTSP_URL = os.environ.get("ELOTO_RTSP_URL", "")
DEVICE_TOKEN = os.environ.get("ELOTO_DEVICE_TOKEN", "")
MODEL_PATH = os.environ.get("ELOTO_MODEL", "yolo11n.pt")
CONF_THRESHOLD = float(os.environ.get("ELOTO_CONF", "0.5"))
MJPEG_PORT = int(os.environ.get("ELOTO_MJPEG_PORT", "8081"))

# ROI polygon (default: center area)
ROI_POINTS = os.environ.get("ELOTO_ROI", "")
if ROI_POINTS:
    try:
        pts = [int(x) for x in ROI_POINTS.split(",")]
        ROI_POLYGON = np.array([[pts[i], pts[i+1]] for i in range(0, len(pts), 2)])
    except (ValueError, IndexError):
        ROI_POLYGON = None
else:
    ROI_POLYGON = None  # Will use full frame if no ROI defined


class RTSPVideoStream:
    """RTSP stream reader di thread terpisah dengan auto-reconnect."""
    def __init__(self, rtsp_url):
        self.rtsp_url = rtsp_url
        self.cap = None
        self.grabbed = False
        self.frame = None
        self.stopped = False
        self.lock = threading.Lock()
        self.last_frame = 0
        self._connect()

    def _connect(self):
        if self.cap and self.cap.isOpened():
            self.cap.release()
        self.cap = cv2.VideoCapture(self.rtsp_url, cv2.CAP_FFMPEG)
        self.cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
        grabbed, frame = self.cap.read()
        with self.lock:
            self.grabbed, self.frame = grabbed, frame
            self.last_frame = time.monotonic() if grabbed else 0

    def start(self):
        t = threading.Thread(target=self.update, daemon=True)
        t.start()
        return self

    def update(self):
        retry_count = 0
        while not self.stopped:
            if not self.cap or not self.cap.isOpened():
                retry_count += 1
                wait = min(retry_count * 2, 30)
                print(f"[RTSP] Reconnect dalam {wait}s (attempt #{retry_count})")
                time.sleep(wait)
                self._connect()
                retry_count = 0
                continue

            grabbed, frame = self.cap.read()
            if not grabbed:
                print("[RTSP] Frame gagal, reconnect...")
                self._connect()
                time.sleep(2)
                continue

            retry_count = 0
            with self.lock:
                self.grabbed = grabbed
                self.frame = frame
                self.last_frame = time.monotonic()

    def read(self):
        with self.lock:
            if self.frame is not None and time.monotonic() - self.last_frame < 5:
                return self.grabbed, self.frame.copy()
            return False, None

    def stop(self):
        self.stopped = True
        if self.cap and self.cap.isOpened():
            self.cap.release()


def is_point_inside_polygon(point, polygon):
    """Cek apakah titik kaki berada di dalam ROI."""
    if polygon is None:
        return True  # No ROI = all detections count
    result = cv2.pointPolygonTest(polygon, (float(point[0]), float(point[1])), False)
    return result >= 0


# ==============================================================================
# MJPEG HTTP SERVER — serve latest frame dari people counting
# ==============================================================================
class MJPEGFrame:
    """Shared latest frame antara detection thread dan HTTP server."""
    def __init__(self):
        self.frame = None
        self.lock = threading.Lock()
        self.annotated = None

    def update(self, frame, annotated):
        with self.lock:
            self.frame = frame
            self.annotated = annotated

    def get_jpeg(self, quality=50):
        with self.lock:
            if self.annotated is None:
                return None
            ret, buf = cv2.imencode('.jpg', self.annotated, [cv2.IMWRITE_JPEG_QUALITY, quality])
            return buf.tobytes() if ret else None


mjpeg_frame = MJPEGFrame()


class MJPEGHandler(BaseHTTPRequestHandler):
    """HTTP handler untuk serve MJPEG stream."""
    def do_GET(self):
        if self.path == '/stream':
            self.send_response(200)
            self.send_header('Content-Type', 'multipart/x-mixed-replace; boundary=frame')
            self.send_header('Cache-Control', 'no-cache')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()

            while True:
                jpeg_data = mjpeg_frame.get_jpeg()
                if jpeg_data:
                    self.wfile.write(f'--frame\r\nContent-Type: image/jpeg\r\nContent-Length: {len(jpeg_data)}\r\n\r\n'.encode())
                    self.wfile.write(jpeg_data)
                    self.wfile.write(b'\r\n')
                    try:
                        self.wfile.flush()
                    except (BrokenPipeError, ConnectionResetError):
                        break
                time.sleep(0.05)

        elif self.path == '/status':
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            import json
            self.wfile.write(json.dumps({'status': 'ok', 'box_id': BOX_ID, 'mjpeg_port': MJPEG_PORT}).encode())

        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, format, *args):
        pass  # Suppress HTTP logs


def start_mjpeg_server():
    """Start MJPEG HTTP server di thread terpisah."""
    server = ThreadingHTTPServer(('127.0.0.1', MJPEG_PORT), MJPEGHandler)
    t = threading.Thread(target=server.serve_forever, daemon=True)
    t.start()
    print(f"[MJPEG] Server aktif di port {MJPEG_PORT} — stream: http://127.0.0.1:{MJPEG_PORT}/stream")
    return server


class BackendSync:
    """Thread untuk sinkronisasi data counting ke backend."""
    def __init__(self, box_id, api_url):
        self.box_id = box_id
        self.api_url = api_url
        self.current_count = 0
        self.last_detection = 0
        self.registered_count = 0
        self.session_id = None
        self.lock = threading.Lock()
        self.running = True
        self.connected = False

    def update_count(self, detected):
        with self.lock:
            self.current_count = detected
            self.last_detection = time.monotonic()

    def _get_session_from_backend(self):
        """Ambil session info dari backend."""
        try:
            resp = requests.get(
                f"{self.api_url}/logs/tapping-history/stats",
                params={"id_box": self.box_id},
                headers={"X-Device-Token": DEVICE_TOKEN},
                timeout=5
            )
            if resp.ok:
                data = resp.json()
                stats = data.get("data", [])
                if stats:
                    latest = stats[0]
                    with self.lock:
                        self.registered_count = int(latest.get("active_users", 0))
                        self.session_id = latest.get("session_id")
                    self.connected = True
                else:
                    with self.lock:
                        self.registered_count = 0
                        self.session_id = None
            else:
                self.connected = False
        except (requests.exceptions.RequestException, ValueError, TypeError, KeyError):
            self.connected = False

    def _send_count(self):
        """Kirim jumlah orang terdeteksi ke backend."""
        with self.lock:
            if time.monotonic() - self.last_detection > 10:
                self.connected = False
                return
            payload = {
                "id_box": self.box_id,
                "session_id": self.session_id,
                "detected_count": self.current_count,
                "registered_count": self.registered_count
            }
        try:
            resp = requests.post(
                f"{self.api_url}/logs/people-counting",
                json=payload,
                headers={"X-Device-Token": DEVICE_TOKEN},
                timeout=5
            )
            self.connected = resp.ok
        except (requests.exceptions.RequestException, ValueError, TypeError, KeyError):
            self.connected = False

    def run(self):
        last_session_check = 0
        while self.running:
            now = time.time()

            # Refresh session info tiap 30 detik
            if now - last_session_check > 30:
                self._get_session_from_backend()
                last_session_check = now

            # Kirim count
            self._send_count()
            time.sleep(SYNC_INTERVAL)

    def stop(self):
        self.running = False


def process_stream(stream_name, rtsp_url, roi_polygon, model, person_class_id, syncer):
    """Proses satu RTSP stream dengan YOLO detection."""
    vs = RTSPVideoStream(rtsp_url)
    time.sleep(1.0)

    if not vs.cap or not vs.cap.isOpened():
        print(f"[ERROR] [{stream_name}] Gagal koneksi kamera")
        return

    if not HEADLESS:
        window_title = f"E-LOTO Monitoring - {stream_name}"
        cv2.namedWindow(window_title, cv2.WINDOW_NORMAL)
        cv2.resizeWindow(window_title, 1280, 720)

    print(f"[INFO] [{stream_name}] Terhubung. Mode: {'HEADLESS' if HEADLESS else 'DISPLAY'}")

    vs.start()
    frame_count = 0

    try:
        while True:
            success, frame = vs.read()
            if not success or frame is None:
                time.sleep(0.01)
                continue

            # YOLO detection
            results = model.track(
                source=frame,
                persist=True,
                classes=[person_class_id],
                conf=CONF_THRESHOLD,
                imgsz=640,
                verbose=False
            )

            people_in_roi = 0

            if results[0].boxes is not None:
                boxes = results[0].boxes.xyxy.cpu().numpy()
                for box in boxes:
                    x1, y1, x2, y2 = map(int, box[:4])
                    foot_point = (int((x1 + x2) / 2), int(y2))

                    if is_point_inside_polygon(foot_point, roi_polygon):
                        people_in_roi += 1

            # Update syncer
            syncer.update_count(people_in_roi)

            # Update MJPEG frame for web streaming
            annotated = frame.copy()
            if roi_polygon is not None:
                cv2.polylines(annotated, [roi_polygon], True, (255, 0, 255), 2)
            if results[0].boxes is not None:
                for box in results[0].boxes.xyxy.cpu().numpy():
                    x1, y1, x2, y2 = map(int, box[:4])
                    foot = (int((x1 + x2) / 2), int(y2))
                    in_roi = is_point_inside_polygon(foot, roi_polygon)
                    color = (0, 255, 0) if in_roi else (0, 0, 255)
                    cv2.rectangle(annotated, (x1, y1), (x2, y2), color, 2)
                    cv2.circle(annotated, foot, 5, color, -1)
            cv2.putText(annotated, f"Detected: {people_in_roi} | Registered: {syncer.registered_count}",
                        (30, 50), cv2.FONT_HERSHEY_SIMPLEX, 1.0, (0, 255, 0), 2)
            if people_in_roi != syncer.registered_count:
                cv2.putText(annotated, "WARNING: COUNT MISMATCH - LOTO NOT SAFE",
                            (30, 130), cv2.FONT_HERSHEY_SIMPLEX, 0.75, (0, 0, 255), 2)
            cv2.putText(annotated, f"Backend: {'ONLINE' if syncer.connected else 'OFFLINE'}",
                        (30, 90), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 200, 255), 2)
            mjpeg_frame.update(frame, annotated)

            # Log
            frame_count += 1
            if frame_count % 30 == 0:
                status = "ONLINE" if syncer.connected else "OFFLINE"
                warning = " | WARNING COUNT MISMATCH" if people_in_roi != syncer.registered_count else ""
                print(f"[{stream_name}] Frame {frame_count} | ROI: {people_in_roi} | Registered: {syncer.registered_count} | Backend: {status}{warning}")

            # Display (non-headless)
            if not HEADLESS:
                cv2.imshow(window_title, mjpeg_frame.annotated)
                if cv2.waitKey(1) & 0xFF == ord('q'):
                    break
            else:
                time.sleep(0.03)

    finally:
        vs.stop()
        if not HEADLESS:
            cv2.destroyAllWindows()


def main():
    print("=" * 50)
    print("  E-LOTO People Counting (YOLO + Backend)")
    print("=" * 50)
    print(f"  Backend  : {BACKEND_URL}")
    print(f"  Box ID   : {BOX_ID}")
    if not RTSP_URL or len(DEVICE_TOKEN) < 32:
        raise ValueError("Set ELOTO_RTSP_URL dan ELOTO_DEVICE_TOKEN sebelum menjalankan counting")
    print("  RTSP     : configured")
    print(f"  Model    : {MODEL_PATH}")
    print(f"  Headless : {HEADLESS}")
    print(f"  Sync     : {SYNC_INTERVAL}s")
    print(f"  ROI      : {'Custom' if ROI_POLYGON is not None else 'Full Frame'}")
    print("=" * 50)

    # Load model
    print("[INFO] Memuat model YOLO...")
    model = YOLO(MODEL_PATH)

    person_class_id = None
    for cid, name in model.names.items():
        if name.lower() == "person":
            person_class_id = cid
            break

    if person_class_id is None:
        print("[ERROR] Class 'person' tidak ditemukan dalam model!")
        return

    print(f"[INFO] Person class ID: {person_class_id}")

    # Start backend sync
    syncer = BackendSync(BOX_ID, BACKEND_URL)
    sync_thread = threading.Thread(target=syncer.run, daemon=True)
    sync_thread.start()
    print(f"[INFO] Backend sync aktif (interval {SYNC_INTERVAL}s)")

    # Start MJPEG server for web streaming
    start_mjpeg_server()

    # Start detection
    try:
        process_stream("Kamera_1", RTSP_URL, ROI_POLYGON, model, person_class_id, syncer)
    except KeyboardInterrupt:
        print("\n[INFO] Dihentikan oleh user")
    finally:
        syncer.stop()
        print("[INFO] Selesai")


if __name__ == "__main__":
    main()
