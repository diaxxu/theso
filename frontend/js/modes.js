// THESO-GCS // modes.js
// Gimbal and system mode management

const MODES = ['FREE', 'TRACK', 'GPS_SLAVE', 'STRIKE'];
const MODE_BTN_MAP = {
    'FREE':      'mBtn-free',
    'TRACK':     'mBtn-track',
    'GPS_SLAVE': 'mBtn-slave',
    'STRIKE':    'mBtn-strike'
};

function setMode(mode) {
    if (!MODES.includes(mode)) return;

    // Strike mode requires confirmation
    if (mode === 'STRIKE') {
        if (!confirm('ENABLE STRIKE MODE?\nSTRIKE MODE WILL ENABLE GUIDED IMPACT TARGETING.')) return;
    }

    GCS.gimbal.mode = mode;

    // Update buttons
    MODES.forEach(m => {
        const btn = document.getElementById(MODE_BTN_MAP[m]);
        if (btn) btn.classList.toggle('active', m === mode);
    });

    // Update HUD
    document.getElementById('hud-mode').textContent  = `MODE: ${mode}`;
    document.getElementById('g-mode').textContent    = mode;
    document.getElementById('ac-mode-display').textContent = `MODE: ${mode}`;

    // Map click behavior label
    const mapLabel = document.getElementById('map-mode-label');
    if (mode === 'GPS_SLAVE' || mode === 'STRIKE') {
        mapLabel.textContent = 'CLICK: SET TARGET';
        mapLabel.style.color = mode === 'STRIKE' ? 'var(--red)' : 'var(--amber)';
    } else {
        mapLabel.textContent = 'CLICK: WAYPOINT';
        mapLabel.style.color = 'var(--text-dim)';
    }

    // Strike confirm button
    document.getElementById('btn-strike-confirm').style.display =
        (mode === 'STRIKE' && GCS.target.lat) ? 'block' : 'none';

    // Track box
    if (mode !== 'TRACK') {
        document.getElementById('track-box').style.display = 'none';
        document.getElementById('hud-track-status').textContent = 'TRACK: OFF';
    } else {
        document.getElementById('hud-track-status').textContent = 'TRACK: ARMED';
        logMsg('DOUBLE-CLICK VIDEO TO INIT TRACKER', 'WARN');
    }

    // Send to backend
    send({ type: 'SET_GIMBAL_MODE', mode });
    logMsg(`GIMBAL MODE: ${mode}`, mode === 'STRIKE' ? 'ERROR' : 'WARN');
}
