#!/usr/bin/env python3
"""
THESO-GCS // backend/gimbal_handler.py
Gimbal state management and command dispatch
"""

import time
import logging

log = logging.getLogger('Gimbal')


class GimbalHandler:
    def __init__(self, mav):
        self.mav   = mav
        self.mode  = 'FREE'
        self.pan   = 0.0
        self.tilt  = 0.0
        self._last_rate_time = 0

    def set_mode(self, mode):
        self.mode = mode
        log.info(f"Gimbal mode: {mode}")
        if mode == 'FREE':
            self.send_rate(0, 0)

    def send_rate(self, pan_rate, tilt_rate):
        """Send gimbal rate commands (deg/s)"""
        # Integrate locally for display
        now = time.time()
        dt  = now - self._last_rate_time if self._last_rate_time else 0
        self._last_rate_time = now
        if dt < 1.0:
            self.pan  = max(-180, min(180,  self.pan  + pan_rate  * dt))
            self.tilt = max(-90,  min(0,    self.tilt + tilt_rate * dt))
        self.mav.gimbal_rate(pan_rate, tilt_rate)

    def send_point(self, pan_deg, tilt_deg):
        """Send absolute gimbal angles"""
        self.pan  = max(-180, min(180, pan_deg))
        self.tilt = max(-90,  min(0,   tilt_deg))
        self.mav.gimbal_point(self.pan, self.tilt)

    def center(self):
        self.send_point(0, 0)
        log.info("Gimbal centered")

    def get_status(self):
        return {
            'pan':  round(self.pan,  1),
            'tilt': round(self.tilt, 1),
            'mode': self.mode
        }
