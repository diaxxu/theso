// THESO-GCS // app.js
// Core WebSocket connection and telemetry handler

const GCS = {
    ws: null,
    connected: false,
    telemetry: {},
    gimbal: { pan: 0, tilt: 0, mode: 'FREE' },
    target: { lat: null, lon: null },
    pktCount: 0,
    lastPktTime: 0,
    latency: 0,
    fpsSamples: [],
    lastFrameTime: 0
};

// ─── CONNECTION ───────────────────────────────────────────────
function toggleConnect() {
    if (GCS.connected) {
        disconnect();
    } else {
        connect();
    }
}

function connect() {
    const host = document.getElementById('conn-host').value;
    const port = document.getElementById('conn-port').value;
    const url  = `ws://${host}:${port}`;

    logMsg(`CONNECTING TO ${url}`, 'WARN');

    try {
        GCS.ws = new WebSocket(url);

        GCS.ws.onopen = () => {
            GCS.connected = true;
            setConnStatus(true);
            logMsg('WEBSOCKET CONNECTED', 'OK');
            document.getElementById('btn-connect').textContent = 'DISCONNECT';
        };

        GCS.ws.onmessage = (evt) => {
            handleMessage(evt.data);
        };

        GCS.ws.onclose = () => {
            GCS.connected = false;
            setConnStatus(false);
            logMsg('CONNECTION CLOSED', 'WARN');
            document.getElementById('btn-connect').textContent = 'CONNECT';
        };

        GCS.ws.onerror = () => {
            logMsg('WEBSOCKET ERROR', 'ERROR');
        };

    } catch (e) {
        logMsg(`CONNECTION FAILED: ${e.message}`, 'ERROR');
    }
}

function disconnect() {
    if (GCS.ws) GCS.ws.close();
}

// ─── MESSAGE HANDLER ──────────────────────────────────────────
function handleMessage(raw) {
    GCS.pktCount++;
    GCS.lastPktTime = Date.now();
    document.getElementById('bb-packets').textContent = `PKT RX: ${GCS.pktCount}`;

    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    // Latency ping/pong
    if (msg.type === 'PONG') {
        GCS.latency = Date.now() - msg.ts;
        document.getElementById('bb-latency').textContent = `LATENCY: ${GCS.latency}ms`;
        return;
    }

    if (msg.type === 'TELEMETRY') {
        updateTelemetry(msg.data);
        return;
    }

    if (msg.type === 'GIMBAL_STATUS') {
        updateGimbalStatus(msg.data);
        return;
    }

    if (msg.type === 'MODE_ACK') {
        logMsg(`MODE SET: ${msg.mode}`, 'OK');
        return;
    }

    if (msg.type === 'SYS_MSG') {
        logMsg(msg.text, msg.level || 'INFO');
        return;
    }

    if (msg.type === 'TRACK_UPDATE') {
        updateTrackBox(msg.box);
        return;
    }
}

// ─── TELEMETRY UPDATE ─────────────────────────────────────────
function updateTelemetry(d) {
    GCS.telemetry = d;

    setVal('t-alt',      d.alt     != null ? d.alt.toFixed(1) : '---');
    setVal('t-spd',      d.gndspd  != null ? d.gndspd.toFixed(1) : '--');
    setVal('t-aspd',     d.airspd  != null ? d.airspd.toFixed(1) : '--');
    setVal('t-hdg',      d.heading != null ? Math.round(d.heading) : '---');
    setVal('t-pitch',    d.pitch   != null ? d.pitch.toFixed(1) : '--');
    setVal('t-roll',     d.roll    != null ? d.roll.toFixed(1) : '--');
    setVal('t-batt',     d.batt_v  != null ? d.batt_v.toFixed(1) : '--');
    setVal('t-batt-pct', d.batt_pct != null ? Math.round(d.batt_pct) : '--');
    setVal('t-thr',      d.thr     != null ? Math.round(d.thr) : '--');
    setVal('t-lat',      d.lat     != null ? d.lat.toFixed(6) : '--');
    setVal('t-lon',      d.lon     != null ? d.lon.toFixed(6) : '--');

    // HUD
    setVal('hud-alt',  `ALT: ${d.alt != null ? d.alt.toFixed(0) : '---'}m`);
    setVal('hud-spd',  `SPD: ${d.gndspd != null ? d.gndspd.toFixed(1) : '--'}m/s`);
    setVal('hud-hdg',  `HDG: ${d.heading != null ? Math.round(d.heading) : '---'}`);
    setVal('hud-batt', `BAT: ${d.batt_pct != null ? Math.round(d.batt_pct) : '--'}%`);

    // GPS status
    if (d.fix_type != null) {
        const fixLabels = ['NO FIX','NO FIX','2D FIX','3D FIX','DGPS','RTK FLOAT','RTK FIXED'];
        document.getElementById('gps-fix').textContent = `GPS: ${fixLabels[d.fix_type] || 'UNK'}`;
        document.getElementById('gps-fix').style.color = d.fix_type >= 3 ? 'var(--green)' : 'var(--red)';
    }

    if (d.sat_count != null) {
        document.getElementById('sat-count').textContent = `SAT: ${d.sat_count}`;
    }

    if (d.flight_mode != null) {
        setVal('ac-mode-display', `MODE: ${d.flight_mode}`);
    }

    if (d.armed != null) {
        const armEl = document.getElementById('ac-armed');
        armEl.textContent = `ARMED: ${d.armed ? 'YES' : 'NO'}`;
        armEl.style.color = d.armed ? 'var(--amber)' : 'var(--green)';
    }

    // Update map aircraft position
    if (d.lat && d.lon && typeof mapUpdateAircraft === 'function') {
        mapUpdateAircraft(d.lat, d.lon, d.heading || 0);
    }

    // Target distance
    if (GCS.target.lat && GCS.target.lon && d.lat && d.lon) {
        const dist = haversine(d.lat, d.lon, GCS.target.lat, GCS.target.lon);
        setVal('tgt-dist', Math.round(dist));
    }
}

function updateGimbalStatus(d) {
    if (d.pan  != null) { GCS.gimbal.pan  = d.pan;  setVal('g-pan',  d.pan.toFixed(1)); }
    if (d.tilt != null) { GCS.gimbal.tilt = d.tilt; setVal('g-tilt', d.tilt.toFixed(1)); }
    if (d.mode != null) { GCS.gimbal.mode = d.mode; setVal('g-mode', d.mode); }
}

// ─── SEND ─────────────────────────────────────────────────────
function send(obj) {
    if (!GCS.ws || GCS.ws.readyState !== WebSocket.OPEN) {
        logMsg('NOT CONNECTED', 'ERROR');
        return false;
    }
    GCS.ws.send(JSON.stringify(obj));
    return true;
}

function sendFlightMode(mode) {
    if (send({ type: 'FLIGHT_MODE', mode })) {
        logMsg(`FLIGHT MODE CMD: ${mode}`, 'WARN');
    }
}

function sendArm() {
    if (confirm('ARM VEHICLE?') && send({ type: 'ARM' })) {
        logMsg('ARM COMMAND SENT', 'WARN');
    }
}

function sendDisarm() {
    if (send({ type: 'DISARM' })) {
        logMsg('DISARM COMMAND SENT', 'WARN');
    }
}

function sendHeading() {
    const hdg = parseFloat(document.getElementById('cmd-hdg').value);
    if (isNaN(hdg)) { logMsg('INVALID HEADING', 'ERROR'); return; }
    if (send({ type: 'SET_HEADING', heading: hdg })) {
        logMsg(`HDG CMD: ${hdg} deg`, 'OK');
    }
}

function sendAltitude() {
    const alt = parseFloat(document.getElementById('cmd-alt').value);
    if (isNaN(alt)) { logMsg('INVALID ALTITUDE', 'ERROR'); return; }
    if (send({ type: 'SET_ALTITUDE', alt })) {
        logMsg(`ALT CMD: ${alt}m`, 'OK');
    }
}

function sendSpeed() {
    const spd = parseFloat(document.getElementById('cmd-spd').value);
    if (isNaN(spd)) { logMsg('INVALID SPEED', 'ERROR'); return; }
    if (send({ type: 'SET_SPEED', speed: spd })) {
        logMsg(`SPD CMD: ${spd}m/s`, 'OK');
    }
}

function sendGimbalDirect() {
    const pan  = parseFloat(document.getElementById('cmd-pan').value);
    const tilt = parseFloat(document.getElementById('cmd-tilt').value);
    if (isNaN(pan) || isNaN(tilt)) { logMsg('INVALID GIMBAL ANGLES', 'ERROR'); return; }
    if (send({ type: 'GIMBAL_POINT', pan, tilt })) {
        logMsg(`GIMBAL: PAN=${pan} TILT=${tilt}`, 'OK');
    }
}

function sendMission() {
    if (window.WAYPOINTS && window.WAYPOINTS.length > 0) {
        if (send({ type: 'UPLOAD_MISSION', waypoints: window.WAYPOINTS })) {
            logMsg(`MISSION UPLOADED: ${window.WAYPOINTS.length} WP`, 'OK');
        }
    } else {
        logMsg('NO WAYPOINTS DEFINED', 'WARN');
    }
}

function clearWaypoints() {
    if (typeof mapClearWaypoints === 'function') mapClearWaypoints();
    logMsg('WAYPOINTS CLEARED', 'OK');
}

function confirmStrike() {
    if (!GCS.target.lat || !GCS.target.lon) {
        logMsg('NO TARGET SELECTED', 'ERROR');
        return;
    }
    if (confirm(`CONFIRM STRIKE TARGET\nLAT: ${GCS.target.lat.toFixed(6)}\nLON: ${GCS.target.lon.toFixed(6)}`)) {
        if (send({ type: 'STRIKE', lat: GCS.target.lat, lon: GCS.target.lon })) {
            logMsg(`STRIKE COMMAND SENT // TGT: ${GCS.target.lat.toFixed(4)}, ${GCS.target.lon.toFixed(4)}`, 'ERROR');
        }
    }
}

// ─── TARGET ───────────────────────────────────────────────────
function setTarget(lat, lon) {
    GCS.target = { lat, lon };
    setVal('tgt-lat', lat.toFixed(6));
    setVal('tgt-lon', lon.toFixed(6));
    document.getElementById('btn-strike-confirm').style.display =
        (document.getElementById('g-mode').textContent === 'STRIKE') ? 'block' : 'none';

    if (GCS.gimbal.mode === 'GPS_SLAVE' || GCS.gimbal.mode === 'STRIKE') {
        send({ type: 'SET_TARGET', lat, lon });
        logMsg(`TARGET SET: ${lat.toFixed(4)}, ${lon.toFixed(4)}`, 'WARN');
    }
}

// ─── TRACK BOX ────────────────────────────────────────────────
function updateTrackBox(box) {
    const tb = document.getElementById('track-box');
    const vc = document.getElementById('video-container');
    if (!box) { tb.style.display = 'none'; return; }

    const scaleX = vc.clientWidth;
    const scaleY = vc.clientHeight;
    tb.style.display = 'block';
    tb.style.left   = `${box.x * scaleX}px`;
    tb.style.top    = `${box.y * scaleY}px`;
    tb.style.width  = `${box.w * scaleX}px`;
    tb.style.height = `${box.h * scaleY}px`;
}

// ─── UI UTILS ─────────────────────────────────────────────────
function setVal(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
}

function setConnStatus(connected) {
    const el = document.getElementById('conn-status');
    if (connected) {
        el.textContent = 'CONNECTED';
        el.className = 'status-badge CONN';
        setVal('ac-callsign', 'AC: THESO-01');
        document.getElementById('link-quality').textContent = 'LINK: 100%';
    } else {
        el.textContent = 'DISCONNECTED';
        el.className = 'status-badge DISC';
        setVal('ac-callsign', 'AC: ------');
        document.getElementById('link-quality').textContent = 'LINK: --%';
    }
}

function logMsg(text, level = 'INFO') {
    const list = document.getElementById('msg-list');
    const now  = new Date();
    const ts   = now.toTimeString().slice(0,8);
    const line = document.createElement('div');
    line.className = `msg-line ${level}`;
    line.textContent = `[${ts}Z] ${text}`;
    list.appendChild(line);
    list.scrollTop = list.scrollHeight;

    // Keep max 100 lines
    while (list.children.length > 100) list.removeChild(list.firstChild);
}

// ─── MATH UTILS ───────────────────────────────────────────────
function haversine(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2)**2 +
              Math.cos(lat1 * Math.PI/180) * Math.cos(lat2 * Math.PI/180) *
              Math.sin(dLon/2)**2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

// ─── CLOCK ────────────────────────────────────────────────────
function updateClock() {
    const now = new Date();
    const z = n => String(n).padStart(2,'0');
    const t = `${z(now.getUTCHours())}:${z(now.getUTCMinutes())}:${z(now.getUTCSeconds())}Z`;
    document.getElementById('sys-clock').textContent = t;
    document.getElementById('hud-time').textContent  = t;
}

setInterval(updateClock, 1000);
updateClock();

// ─── LATENCY PING ─────────────────────────────────────────────
setInterval(() => {
    if (GCS.connected) send({ type: 'PING', ts: Date.now() });
}, 2000);

// ─── INIT ─────────────────────────────────────────────────────
logMsg('THESO-GCS INITIALIZED', 'OK');
logMsg('ENTER HOST AND PORT, CLICK CONNECT', 'INFO');
