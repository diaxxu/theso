#!/usr/bin/env python3
"""
THESO-GCS // backend/tracker.py
Object tracker - pixel error to gimbal rate conversion
Supports: OpenCV CSRT (default), YOLOv8 (if installed)
"""

import logging
import time

log = logging.getLogger('Tracker')

try:
    import cv2
    CV2_AVAILABLE = True
except ImportError:
    CV2_AVAILABLE = False
    log.warning("OpenCV not installed. Tracker disabled.")

try:
    from ultralytics import YOLO
    YOLO_AVAILABLE = True
except ImportError:
    YOLO_AVAILABLE = False


class Tracker:
    def __init__(self):
        self.active     = False
        self.tracker    = None
        self.cap        = None
        self.frame_w    = 1280
        self.frame_h    = 720
        self.box        = None   # (x, y, w, h) normalized 0-1

        # PID gains for gimbal rate from pixel error
        self.Kp_pan  = 80.0   # deg/s per normalized error unit
        self.Kp_tilt = 60.0
        self.Ki_pan  = 0.0
        self.Ki_tilt = 0.0

        self._err_int_pan  = 0.0
        self._err_int_tilt = 0.0
        self._last_t       = time.time()

    def init(self, x_norm, y_norm):
        """Initialize tracker at normalized click coordinates"""
        if not CV2_AVAILABLE:
            log.warning("CV2 not available — tracker init skipped")
            return

        # Default box size around click point
        bw, bh = 0.1, 0.12
        bx = max(0, x_norm - bw/2)
        by = max(0, y_norm - bh/2)
        self.box = (bx, by, bw, bh)

        # In a real deployment, initialize cv2.TrackerCSRT_create() here
        # with the actual video frame
        self.active = True
        self._err_int_pan  = 0.0
        self._err_int_tilt = 0.0
        log.info(f"Tracker init at ({x_norm:.3f}, {y_norm:.3f})")

    def update(self):
        """
        Update tracker, return (pan_rate, tilt_rate, box_dict)
        In production: update cv2 tracker with new frame, compute error
        """
        if not self.active or not self.box:
            return 0.0, 0.0, None

        now = time.time()
        dt  = now - self._last_t
        self._last_t = now

        bx, by, bw, bh = self.box

        # Pixel error from frame center (normalized -0.5 to 0.5)
        cx = bx + bw / 2
        cy = by + bh / 2
        err_pan  =  (cx - 0.5)
        err_tilt = -(cy - 0.5)

        # Integrator
        self._err_int_pan  += err_pan  * dt
        self._err_int_tilt += err_tilt * dt

        pan_rate  = self.Kp_pan  * err_pan  + self.Ki_pan  * self._err_int_pan
        tilt_rate = self.Kp_tilt * err_tilt + self.Ki_tilt * self._err_int_tilt

        # Clamp rates
        pan_rate  = max(-90, min(90, pan_rate))
        tilt_rate = max(-60, min(60, tilt_rate))

        box_out = {'x': bx, 'y': by, 'w': bw, 'h': bh}
        return round(pan_rate, 2), round(tilt_rate, 2), box_out

    def stop(self):
        self.active = False
        self.box    = None
        log.info("Tracker stopped")


# ─── YOLO TRACKER (drop-in replacement) ──────────────────────
class YOLOTracker(Tracker):
    """
    YOLOv8-based tracker. Install: pip install ultralytics
    Usage: replace Tracker() with YOLOTracker(model_path, class_id)
    """
    def __init__(self, model_path='yolov8n.pt', class_id=2):  # class 2 = car
        super().__init__()
        self.class_id = class_id
        self.model    = None
        if YOLO_AVAILABLE:
            try:
                self.model = YOLO(model_path)
                log.info(f"YOLOv8 loaded: {model_path}")
            except Exception as e:
                log.error(f"YOLO load failed: {e}")

    def update_frame(self, frame):
        """Call this with each video frame. Updates internal box."""
        if not self.model or not self.active:
            return

        results = self.model(frame, verbose=False)[0]
        best_conf = 0
        best_box  = None

        for box in results.boxes:
            if int(box.cls) != self.class_id:
                continue
            conf = float(box.conf)
            if conf > best_conf:
                best_conf = conf
                x1, y1, x2, y2 = box.xyxy[0].tolist()
                h, w = frame.shape[:2]
                best_box = (
                    x1 / w,
                    y1 / h,
                    (x2 - x1) / w,
                    (y2 - y1) / h
                )

        if best_box:
            self.box = best_box
