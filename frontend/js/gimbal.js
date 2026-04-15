// THESO-GCS // gimbal.js
// Click-to-slew and rate control for gimbal

const GIMBAL = {
    slewing: false,
    lastX: 0,
    lastY: 0,
    sensitivity: 0.15,   // deg per pixel
    rateMode: true        // true = rate commands, false = absolute
};

// ─── VIDEO CANVAS MOUSE CONTROL ───────────────────────────────
const videoContainer = document.getElementById('video-container');

videoContainer.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    GIMBAL.slewing = true;
    GIMBAL.lastX = e.clientX;
    GIMBAL.lastY = e.clientY;
    e.preventDefault();
});

videoContainer.addEventListener('mouseup', () => {
    GIMBAL.slewing = false;
    // Send zero rate to stop
    if (GCS.gimbal.mode === 'FREE') {
        send({ type: 'GIMBAL_RATE', pan: 0, tilt: 0 });
    }
});

videoContainer.addEventListener('mouseleave', () => {
    if (GIMBAL.slewing) {
        GIMBAL.slewing = false;
        send({ type: 'GIMBAL_RATE', pan: 0, tilt: 0 });
    }
});

videoContainer.addEventListener('mousemove', (e) => {
    if (!GIMBAL.slewing) return;
    if (GCS.gimbal.mode !== 'FREE') return;

    const dx = e.clientX - GIMBAL.lastX;
    const dy = e.clientY - GIMBAL.lastY;
    GIMBAL.lastX = e.clientX;
    GIMBAL.lastY = e.clientY;

    const panRate  =  dx * GIMBAL.sensitivity;
    const tiltRate = -dy * GIMBAL.sensitivity;

    send({
        type: 'GIMBAL_RATE',
        pan:  parseFloat(panRate.toFixed(3)),
        tilt: parseFloat(tiltRate.toFixed(3))
    });
});

// Right click → center gimbal
videoContainer.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    send({ type: 'GIMBAL_CENTER' });
    logMsg('GIMBAL CENTER CMD', 'OK');
});

// Double click → lock track on click point (TRACK mode)
videoContainer.addEventListener('dblclick', (e) => {
    if (GCS.gimbal.mode !== 'TRACK') return;
    const rect = videoContainer.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top)  / rect.height;
    send({ type: 'TRACK_INIT', x, y });
    logMsg(`TRACK INIT: (${x.toFixed(3)}, ${y.toFixed(3)})`, 'WARN');
});

// ─── KEYBOARD SHORTCUTS ───────────────────────────────────────
document.addEventListener('keydown', (e) => {
    const step = 5; // degrees

    if (e.target.tagName === 'INPUT') return;

    switch (e.key) {
        case 'ArrowLeft':
            send({ type: 'GIMBAL_POINT', pan: GCS.gimbal.pan - step, tilt: GCS.gimbal.tilt });
            break;
        case 'ArrowRight':
            send({ type: 'GIMBAL_POINT', pan: GCS.gimbal.pan + step, tilt: GCS.gimbal.tilt });
            break;
        case 'ArrowUp':
            send({ type: 'GIMBAL_POINT', pan: GCS.gimbal.pan, tilt: Math.min(0, GCS.gimbal.tilt + step) });
            break;
        case 'ArrowDown':
            send({ type: 'GIMBAL_POINT', pan: GCS.gimbal.pan, tilt: Math.max(-90, GCS.gimbal.tilt - step) });
            break;
        case 'c':
        case 'C':
            send({ type: 'GIMBAL_CENTER' });
            logMsg('GIMBAL CENTER (KEY)', 'OK');
            break;
        case '1': setMode('FREE');      break;
        case '2': setMode('TRACK');     break;
        case '3': setMode('GPS_SLAVE'); break;
        case '4': setMode('STRIKE');    break;
        case 'h':
        case 'H':
            sendFlightMode('RTL');
            break;
    }
});

// ─── SENSITIVITY SCROLL ───────────────────────────────────────
videoContainer.addEventListener('wheel', (e) => {
    e.preventDefault();
    GIMBAL.sensitivity = Math.max(0.02, Math.min(1.0,
        GIMBAL.sensitivity - (e.deltaY > 0 ? 0.01 : -0.01)
    ));
    logMsg(`SLEW SENSITIVITY: ${GIMBAL.sensitivity.toFixed(2)}`, 'INFO');
}, { passive: false });
