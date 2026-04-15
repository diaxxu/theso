#!/usr/bin/env python3
"""
THESO-GCS // backend/server.py
WebSocket server bridging the web frontend to MAVLink autopilot + gimbal
"""

import asyncio
import json
import logging
import time
import argparse
from pathlib import Path

try:
    import websockets
    from websockets.exceptions import ConnectionClosed
except ImportError:
    print("[ERROR] websockets not installed. Run: pip install websockets")
    exit(1)

from mavlink_handler import MAVLinkHandler
from gimbal_handler   import GimbalHandler
from tracker          import Tracker

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    datefmt='%H:%M:%S'
)
log = logging.getLogger('THESO-GCS')


class ThesoGCS:
    def __init__(self, args):
        self.args     = args
        self.clients  = set()
        self.mav      = MAVLinkHandler(args.connection)
        self.gimbal   = GimbalHandler(self.mav)
        self.tracker  = Tracker()
        self.mode     = 'FREE'
        self.target   = None   # (lat, lon)
        self.running  = True

    # ─── WEBSOCKET HANDLER ────────────────────────────────────
    async def client_handler(self, ws):
        self.clients.add(ws)
        addr = ws.remote_address
        log.info(f"CLIENT CONNECTED: {addr}")

        await self.send_to(ws, {
            'type': 'SYS_MSG',
            'text': 'THESO-GCS BACKEND CONNECTED',
            'level': 'OK'
        })

        try:
            async for raw in ws:
                await self.handle_command(ws, raw)
        except ConnectionClosed:
            log.info(f"CLIENT DISCONNECTED: {addr}")
        finally:
            self.clients.discard(ws)

    async def handle_command(self, ws, raw):
        try:
            msg = json.loads(raw)
        except json.JSONDecodeError:
            return

        t = msg.get('type')

        if t == 'PING':
            await self.send_to(ws, {'type': 'PONG', 'ts': msg.get('ts', 0)})

        elif t == 'ARM':
            self.mav.arm()
            log.info("ARM COMMAND")

        elif t == 'DISARM':
            self.mav.disarm()
            log.info("DISARM COMMAND")

        elif t == 'FLIGHT_MODE':
            self.mav.set_flight_mode(msg['mode'])
            log.info(f"FLIGHT MODE: {msg['mode']}")

        elif t == 'SET_HEADING':
            self.mav.set_heading(msg['heading'])
            log.info(f"HEADING: {msg['heading']}")

        elif t == 'SET_ALTITUDE':
            self.mav.set_altitude(msg['alt'])
            log.info(f"ALTITUDE: {msg['alt']}m")

        elif t == 'SET_SPEED':
            self.mav.set_speed(msg['speed'])
            log.info(f"SPEED: {msg['speed']}m/s")

        elif t == 'SET_GIMBAL_MODE':
            self.mode = msg['mode']
            self.gimbal.set_mode(self.mode)
            log.info(f"GIMBAL MODE: {self.mode}")

        elif t == 'GIMBAL_RATE':
            if self.mode == 'FREE':
                self.gimbal.send_rate(msg.get('pan', 0), msg.get('tilt', 0))

        elif t == 'GIMBAL_POINT':
            self.gimbal.send_point(msg.get('pan', 0), msg.get('tilt', 0))

        elif t == 'GIMBAL_CENTER':
            self.gimbal.center()

        elif t == 'SET_TARGET':
            self.target = (msg['lat'], msg['lon'])
            log.info(f"TARGET: {self.target}")
            if self.mode == 'STRIKE':
                await self.broadcast({'type': 'SYS_MSG',
                    'text': f"TARGET ACQUIRED: {msg['lat']:.4f}, {msg['lon']:.4f}",
                    'level': 'ERROR'})

        elif t == 'TRACK_INIT':
            self.tracker.init(msg.get('x', 0.5), msg.get('y', 0.5))
            log.info(f"TRACKER INIT: ({msg.get('x'):.3f}, {msg.get('y'):.3f})")

        elif t == 'STRIKE':
            if self.target:
                self.mav.guided_target(*self.target, msg.get('alt', 50))
                log.warning(f"STRIKE CMD: {self.target}")
                await self.broadcast({'type': 'SYS_MSG',
                    'text': 'STRIKE COMMAND EXECUTED',
                    'level': 'ERROR'})

        elif t == 'UPLOAD_MISSION':
            wps = msg.get('waypoints', [])
            self.mav.upload_mission(wps)
            log.info(f"MISSION UPLOAD: {len(wps)} waypoints")

    # ─── TELEMETRY LOOP ───────────────────────────────────────
    async def telemetry_loop(self):
        while self.running:
            if self.clients:
                telem = self.mav.get_telemetry()
                if telem:
                    await self.broadcast({'type': 'TELEMETRY', 'data': telem})

                gst = self.gimbal.get_status()
                if gst:
                    await self.broadcast({'type': 'GIMBAL_STATUS', 'data': gst})

            await asyncio.sleep(0.1)   # 10 Hz telemetry

    # ─── TRACKER LOOP ─────────────────────────────────────────
    async def tracker_loop(self):
        """Run tracker, send gimbal rate corrections and track box to clients"""
        while self.running:
            if self.mode == 'TRACK' and self.tracker.active:
                rate_pan, rate_tilt, box = self.tracker.update()
                self.gimbal.send_rate(rate_pan, rate_tilt)
                if self.clients and box:
                    await self.broadcast({'type': 'TRACK_UPDATE', 'box': box})

            await asyncio.sleep(0.033)  # ~30 Hz

    # ─── BROADCAST ────────────────────────────────────────────
    async def broadcast(self, obj):
        if not self.clients:
            return
        msg = json.dumps(obj)
        dead = set()
        for ws in self.clients:
            try:
                await ws.send(msg)
            except ConnectionClosed:
                dead.add(ws)
        self.clients -= dead

    async def send_to(self, ws, obj):
        try:
            await ws.send(json.dumps(obj))
        except ConnectionClosed:
            self.clients.discard(ws)

    # ─── RUN ──────────────────────────────────────────────────
    async def run(self):
        log.info(f"THESO-GCS STARTING")
        log.info(f"MAVLink connection: {self.args.connection}")
        log.info(f"WebSocket server: ws://0.0.0.0:{self.args.port}")

        # Connect MAVLink
        self.mav.connect()

        # Start background tasks
        asyncio.create_task(self.telemetry_loop())
        asyncio.create_task(self.tracker_loop())

        # WebSocket server
        async with websockets.serve(self.client_handler, '0.0.0.0', self.args.port):
            log.info(f"GCS READY — open frontend/index.html")
            await asyncio.Future()  # run forever


def main():
    parser = argparse.ArgumentParser(description='THESO Ground Control System')
    parser.add_argument('--connection', default='udp:0.0.0.0:14550',
                        help='MAVLink connection string (default: udp:0.0.0.0:14550)')
    parser.add_argument('--port', type=int, default=8765,
                        help='WebSocket port (default: 8765)')
    args = parser.parse_args()

    gcs = ThesoGCS(args)

    try:
        asyncio.run(gcs.run())
    except KeyboardInterrupt:
        log.info("THESO-GCS SHUTDOWN")


if __name__ == '__main__':
    main()
