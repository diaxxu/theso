#!/usr/bin/env python3
"""
THESO-GCS // backend/mavlink_handler.py
All MAVLink communication with the autopilot (ArduPilot/PX4)
"""

import time
import logging
import threading
import math

log = logging.getLogger('MAVLink')

try:
    from pymavlink import mavutil
    MAVLINK_AVAILABLE = True
except ImportError:
    log.warning("pymavlink not installed. Running in SIMULATION mode.")
    MAVLINK_AVAILABLE = False


class MAVLinkHandler:
    def __init__(self, connection_str):
        self.connection_str = connection_str
        self.mav            = None
        self.connected      = False
        self.lock           = threading.Lock()
        self._telem         = {}
        self._last_hb       = 0
        self._flight_modes  = {}  # populated on connect
        self._sim_t         = 0   # simulation timer

    # ─── CONNECT ──────────────────────────────────────────────
    def connect(self):
        if not MAVLINK_AVAILABLE:
            log.warning("SIMULATION MODE — no pymavlink")
            self.connected = True
            self._start_sim()
            return

        def _connect():
            try:
                log.info(f"Connecting: {self.connection_str}")
                self.mav = mavutil.mavlink_connection(self.connection_str)
                log.info("Waiting for heartbeat...")
                self.mav.wait_heartbeat(timeout=10)
                self.connected = True
                log.info(f"Heartbeat received — sysid={self.mav.target_system}")
                self._recv_loop()
            except Exception as e:
                log.error(f"MAVLink connect error: {e}")
                log.warning("Falling back to SIMULATION mode")
                self.connected = True
                self._start_sim()

        t = threading.Thread(target=_connect, daemon=True)
        t.start()

    def _recv_loop(self):
        """Continuously receive MAVLink messages and update telemetry dict"""
        while self.connected:
            try:
                msg = self.mav.recv_match(blocking=True, timeout=1.0)
                if not msg:
                    continue
                mt = msg.get_type()

                if mt == 'GLOBAL_POSITION_INT':
                    with self.lock:
                        self._telem['lat']     = msg.lat / 1e7
                        self._telem['lon']     = msg.lon / 1e7
                        self._telem['alt']     = msg.relative_alt / 1000.0
                        self._telem['gndspd']  = math.sqrt(msg.vx**2 + msg.vy**2) / 100.0
                        self._telem['heading'] = msg.hdg / 100.0

                elif mt == 'VFR_HUD':
                    with self.lock:
                        self._telem['airspd'] = msg.airspeed
                        self._telem['thr']    = msg.throttle

                elif mt == 'ATTITUDE':
                    with self.lock:
                        self._telem['pitch'] = math.degrees(msg.pitch)
                        self._telem['roll']  = math.degrees(msg.roll)

                elif mt == 'SYS_STATUS':
                    with self.lock:
                        v = msg.voltage_battery / 1000.0
                        self._telem['batt_v']   = v
                        self._telem['batt_pct'] = msg.battery_remaining

                elif mt == 'GPS_RAW_INT':
                    with self.lock:
                        self._telem['fix_type']  = msg.fix_type
                        self._telem['sat_count'] = msg.satellites_visible

                elif mt == 'HEARTBEAT':
                    self._last_hb = time.time()
                    mode_str = self._decode_mode(msg.custom_mode, msg.base_mode)
                    armed = bool(msg.base_mode & mavutil.mavlink.MAV_MODE_FLAG_SAFETY_ARMED)
                    with self.lock:
                        self._telem['flight_mode'] = mode_str
                        self._telem['armed']        = armed

                elif mt == 'MOUNT_STATUS':
                    with self.lock:
                        self._telem['mount_pan']  = msg.pointing_c / 100.0
                        self._telem['mount_tilt'] = msg.pointing_a / 100.0

            except Exception as e:
                log.debug(f"recv error: {e}")

    # ─── SIMULATION MODE ──────────────────────────────────────
    def _start_sim(self):
        def _sim():
            import math, random
            lat, lon = 34.0209, -6.8416   # Rabat, Morocco
            alt, hdg = 150.0, 0.0
            spd = 25.0
            t   = 0
            while True:
                t += 0.1
                lat += math.cos(math.radians(hdg)) * spd * 0.1 / 111320
                lon += math.sin(math.radians(hdg)) * spd * 0.1 / (111320 * math.cos(math.radians(lat)))
                hdg = (hdg + 0.5) % 360
                alt += math.sin(t * 0.1) * 0.5

                with self.lock:
                    self._telem = {
                        'lat':         lat,
                        'lon':         lon,
                        'alt':         round(alt, 1),
                        'gndspd':      round(spd + random.uniform(-0.5, 0.5), 1),
                        'airspd':      round(spd + 3 + random.uniform(-0.3, 0.3), 1),
                        'heading':     round(hdg, 1),
                        'pitch':       round(math.sin(t * 0.2) * 5, 1),
                        'roll':        round(math.sin(t * 0.3) * 8, 1),
                        'batt_v':      round(23.8 - t * 0.002, 1),
                        'batt_pct':    max(0, round(100 - t * 0.1)),
                        'thr':         65,
                        'fix_type':    3,
                        'sat_count':   14,
                        'flight_mode': 'AUTO',
                        'armed':       True,
                    }
                time.sleep(0.1)

        t = threading.Thread(target=_sim, daemon=True)
        t.start()
        log.info("SIMULATION MODE ACTIVE — aircraft orbiting Rabat")

    # ─── TELEMETRY ────────────────────────────────────────────
    def get_telemetry(self):
        with self.lock:
            return dict(self._telem)

    # ─── COMMANDS ─────────────────────────────────────────────
    def arm(self):
        if not self.mav: return
        self.mav.mav.command_long_send(
            self.mav.target_system, self.mav.target_component,
            mavutil.mavlink.MAV_CMD_COMPONENT_ARM_DISARM, 0,
            1, 0, 0, 0, 0, 0, 0
        )

    def disarm(self):
        if not self.mav: return
        self.mav.mav.command_long_send(
            self.mav.target_system, self.mav.target_component,
            mavutil.mavlink.MAV_CMD_COMPONENT_ARM_DISARM, 0,
            0, 0, 0, 0, 0, 0, 0
        )

    def set_flight_mode(self, mode_str):
        if not self.mav: return
        mode_id = self.mav.mode_mapping().get(mode_str.upper())
        if mode_id is None:
            log.warning(f"Unknown mode: {mode_str}")
            return
        self.mav.mav.set_mode_send(
            self.mav.target_system,
            mavutil.mavlink.MAV_MODE_FLAG_CUSTOM_MODE_ENABLED,
            mode_id
        )

    def set_heading(self, heading_deg):
        if not self.mav: return
        self.mav.mav.command_long_send(
            self.mav.target_system, self.mav.target_component,
            mavutil.mavlink.MAV_CMD_CONDITION_YAW, 0,
            heading_deg, 0, 0, 0, 0, 0, 0
        )

    def set_altitude(self, alt_m):
        if not self.mav: return
        self.mav.mav.command_long_send(
            self.mav.target_system, self.mav.target_component,
            mavutil.mavlink.MAV_CMD_DO_CHANGE_ALTITUDE, 0,
            alt_m, mavutil.mavlink.MAV_FRAME_GLOBAL_RELATIVE_ALT,
            0, 0, 0, 0, 0
        )

    def set_speed(self, speed_ms):
        if not self.mav: return
        self.mav.mav.command_long_send(
            self.mav.target_system, self.mav.target_component,
            mavutil.mavlink.MAV_CMD_DO_CHANGE_SPEED, 0,
            0, speed_ms, -1, 0, 0, 0, 0
        )

    def guided_target(self, lat, lon, alt=50):
        """Send aircraft to GPS coordinate (GUIDED mode)"""
        if not self.mav: return
        self.set_flight_mode('GUIDED')
        time.sleep(0.2)
        self.mav.mav.set_position_target_global_int_send(
            0,
            self.mav.target_system, self.mav.target_component,
            mavutil.mavlink.MAV_FRAME_GLOBAL_RELATIVE_ALT_INT,
            0b0000111111111000,   # position only
            int(lat * 1e7), int(lon * 1e7), alt,
            0, 0, 0,
            0, 0, 0,
            0, 0
        )

    def gimbal_rate(self, pan_rate, tilt_rate):
        """Send gimbal rate command via MAVLink MOUNT_CONTROL"""
        if not self.mav: return
        self.mav.mav.mount_control_send(
            self.mav.target_system, self.mav.target_component,
            int(tilt_rate * 100), 0, int(pan_rate * 100), 0
        )

    def gimbal_point(self, pan_deg, tilt_deg):
        """Point gimbal to absolute angles"""
        if not self.mav: return
        self.mav.mav.mount_control_send(
            self.mav.target_system, self.mav.target_component,
            int(tilt_deg * 100), 0, int(pan_deg * 100), 0
        )

    def upload_mission(self, waypoints):
        if not self.mav: return
        count = len(waypoints) + 1  # +1 for home
        self.mav.mav.mission_count_send(
            self.mav.target_system, self.mav.target_component, count,
            mavutil.mavlink.MAV_MISSION_TYPE_MISSION
        )
        for i, wp in enumerate(waypoints):
            self.mav.mav.mission_item_int_send(
                self.mav.target_system, self.mav.target_component,
                i + 1,
                mavutil.mavlink.MAV_FRAME_GLOBAL_RELATIVE_ALT_INT,
                mavutil.mavlink.MAV_CMD_NAV_WAYPOINT,
                0, 1, 0, 0, 0, 0,
                int(wp['lat'] * 1e7), int(wp['lon'] * 1e7),
                wp.get('alt', 100),
                mavutil.mavlink.MAV_MISSION_TYPE_MISSION
            )

    def _decode_mode(self, custom_mode, base_mode):
        try:
            return self.mav.flightmode
        except:
            return f"MODE_{custom_mode}"
