# THESO-GCS
### Ground Control System — KAELOS Aerospace

Military-grade UAV ground control system with EO/IR gimbal slaving,
auto-tracking, GPS targeting, and guided strike mode.

---

## ARCHITECTURE

```
Browser (frontend)
    ↕ WebSocket :8765
Python backend (server.py)
    ↕ MAVLink UDP :14550
Pixhawk / ArduPilot FC
    ↕ UART/CAN
Gimbal controller + EO/IR ball
```

---

## QUICK START

### 1. Install backend dependencies
```bash
cd backend
pip install -r requirements.txt
```

### 2. Start the backend
```bash
# Real hardware (UDP MAVLink from Pixhawk/SiK radio)
python server.py --connection udp:0.0.0.0:14550

# USB connection
python server.py --connection /dev/ttyUSB0:57600

# SITL simulation (no hardware needed)
python server.py --connection tcp:127.0.0.1:5760
```

### 3. Open the frontend
```
Open frontend/index.html in your browser
Enter 127.0.0.1 : 8765
Click CONNECT
```

---

## SIMULATION MODE

If no MAVLink connection is available, the backend automatically enters
simulation mode. An aircraft will orbit Rabat, Morocco with realistic
telemetry data. Full gimbal and mode switching works in sim.

---

## FEATURES

| Feature | Status |
|---|---|
| Live telemetry (10 Hz) | READY |
| Gimbal click-to-slew | READY |
| Gimbal rate control (mouse drag) | READY |
| Keyboard shortcuts | READY |
| Mode switching (FREE/TRACK/GPS_SLAVE/STRIKE) | READY |
| Leaflet map with aircraft tracking | READY |
| Waypoint planning | READY |
| Mission upload (MAVLink) | READY |
| Auto flight commands (HDG/ALT/SPD) | READY |
| ARM/DISARM | READY |
| Flight mode switching | READY |
| GPS target slaving | READY |
| Guided strike mode | READY |
| Video stream (JSMpeg) | READY |
| Auto-track (OpenCV CSRT) | STUB |
| YOLOv8 tracker | STUB |
| Video relay (GStreamer) | SEPARATE |

---

## KEYBOARD SHORTCUTS

| Key | Action |
|---|---|
| Arrow keys | Gimbal step slew |
| C | Center gimbal |
| 1 | FREE mode |
| 2 | TRACK mode |
| 3 | GPS SLAVE mode |
| 4 | STRIKE mode |
| H | RTL (Return to Launch) |

---

## VIDEO STREAMING

The backend expects an MPEG1 stream over WebSocket on port `WS_PORT + 1` (default: 8766).

### Stream from companion computer (Raspberry Pi):
```bash
# Install gstreamer
# Then run on the Pi:
raspivid -t 0 -w 1280 -h 720 -fps 30 -b 1000000 -o - | \
ffmpeg -i - -f mpegts -codec:v mpeg1video -b:v 800k \
-bf 0 http://GROUND_STATION_IP:8081/stream
```

### Or use node-based relay:
```bash
npm install jsmpeg
node stream-relay.js
```

---

## GIMBAL INTEGRATION

The gimbal controller receives MAVLink `MOUNT_CONTROL` messages.

For your custom STM32 gimbal board:
- Parse MAVLink MOUNT_CONTROL over UART
- Map `input_c` (centidegrees) → pan motor
- Map `input_a` (centidegrees) → tilt motor
- Send MOUNT_STATUS back to autopilot

---

## TRACKER INTEGRATION

To enable YOLOv8 tracking:
```bash
pip install ultralytics opencv-python
```
Then in `tracker.py`, replace `Tracker()` with `YOLOTracker()` in `server.py`.

Double-click the video feed to initialize the tracker on a target.
The gimbal will slave to keep the target centered.

---

## DIRECTORY STRUCTURE

```
theso-ground-station/
├── frontend/
│   ├── index.html
│   ├── css/
│   │   └── style.css
│   └── js/
│       ├── app.js       ← WebSocket + telemetry
│       ├── map.js       ← Leaflet map
│       ├── gimbal.js    ← Mouse slew control
│       ├── modes.js     ← Mode switching
│       └── video.js     ← JSMpeg video
├── backend/
│   ├── server.py        ← WebSocket server + orchestrator
│   ├── mavlink_handler.py ← All MAVLink commands
│   ├── gimbal_handler.py  ← Gimbal state + dispatch
│   ├── tracker.py       ← Object tracker (OpenCV/YOLO)
│   └── requirements.txt
└── README.md
```

---

## BUILT BY
KAELOS Aerospace — EO/IR Systems Division  
Ground Control Software v1.0
