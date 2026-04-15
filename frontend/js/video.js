// THESO-GCS // video.js
// JSMpeg video stream handler

const VIDEO = {
    player: null,
    streamUrl: null,
    frameCount: 0,
    lastFpsTime: Date.now(),
    fps: 0,
    active: false
};

// Load JSMpeg dynamically
function loadJSMpeg(callback) {
    if (window.JSMpeg) { callback(); return; }
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jsmpeg/0.2/jsmpeg.min.js';
    s.onload = callback;
    s.onerror = () => {
        logMsg('JSMPEG LOAD FAILED - VIDEO UNAVAILABLE', 'ERROR');
    };
    document.head.appendChild(s);
}

function initVideo(wsUrl) {
    loadJSMpeg(() => {
        if (!window.JSMpeg) {
            logMsg('JSMPEG NOT AVAILABLE', 'ERROR');
            return;
        }

        if (VIDEO.player) {
            VIDEO.player.destroy();
            VIDEO.player = null;
        }

        const canvas = document.getElementById('video-canvas');

        try {
            VIDEO.player = new JSMpeg.Player(wsUrl, {
                canvas: canvas,
                autoplay: true,
                audio: false,
                loop: false,
                onVideoDecode: () => {
                    VIDEO.frameCount++;
                    updateFps();
                    if (!VIDEO.active) {
                        VIDEO.active = true;
                        document.getElementById('video-offline').style.display = 'none';
                        document.getElementById('hud-rec').textContent = 'REC';
                        logMsg(`VIDEO STREAM ACTIVE: ${wsUrl}`, 'OK');
                    }
                },
                onEnded: () => {
                    VIDEO.active = false;
                    document.getElementById('video-offline').style.display = 'flex';
                    document.getElementById('hud-rec').textContent = '-- REC';
                    logMsg('VIDEO STREAM ENDED', 'WARN');
                }
            });

            logMsg(`VIDEO CONNECTING: ${wsUrl}`, 'WARN');

        } catch(e) {
            logMsg(`VIDEO INIT ERROR: ${e.message}`, 'ERROR');
        }
    });
}

function updateFps() {
    const now = Date.now();
    const elapsed = now - VIDEO.lastFpsTime;
    if (elapsed >= 1000) {
        VIDEO.fps = Math.round(VIDEO.frameCount * 1000 / elapsed);
        VIDEO.frameCount = 0;
        VIDEO.lastFpsTime = now;
        document.getElementById('bb-fps').textContent = `VIDEO: ${VIDEO.fps} FPS`;
    }
}

// Auto-connect video when main WS connects
// Override GCS ws onopen to also init video
const _origConnect = connect;
window.connect = function() {
    _origConnect();
    // After short delay try video stream on port+1
    setTimeout(() => {
        const host = document.getElementById('conn-host').value;
        const port = parseInt(document.getElementById('conn-port').value);
        initVideo(`ws://${host}:${port + 1}`);
    }, 1500);
};
