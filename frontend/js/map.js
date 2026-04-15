// THESO-GCS // map.js
// Leaflet map handler - aircraft tracking, waypoints, target selection

window.WAYPOINTS = [];

let map, aircraftMarker, aircraftTrail = [], trailLine;
let targetMarker = null;
let wpMarkers = [];
let wpCounter = 0;
let mapInitialized = false;

// ─── INIT MAP ─────────────────────────────────────────────────
function initMap() {
    map = L.map('map', {
        center: [0, 0],
        zoom: 4,
        zoomControl: false,
        attributionControl: false
    });

    // Dark satellite tiles
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        opacity: 0.7
    }).addTo(map);

    L.control.zoom({ position: 'bottomright' }).addTo(map);

    // Aircraft icon
    const acIcon = L.divIcon({
        html: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                 <polygon points="12,2 16,22 12,18 8,22" fill="#00ff41" opacity="0.9"/>
               </svg>`,
        iconSize: [24, 24],
        iconAnchor: [12, 12],
        className: ''
    });

    aircraftMarker = L.marker([0, 0], { icon: acIcon }).addTo(map);

    // Trail polyline
    trailLine = L.polyline([], {
        color: 'rgba(0,255,65,0.3)',
        weight: 1,
        dashArray: '4,4'
    }).addTo(map);

    // Map click → waypoint or target
    map.on('click', (e) => {
        const { lat, lng } = e.latlng;

        if (document.getElementById('g-mode').textContent === 'GPS_SLAVE' ||
            document.getElementById('g-mode').textContent === 'STRIKE') {
            setTarget(lat, lng);
            placeTargetMarker(lat, lng);
        } else {
            addWaypoint(lat, lng);
        }
    });

    mapInitialized = true;
}

// ─── AIRCRAFT ─────────────────────────────────────────────────
function mapUpdateAircraft(lat, lon, heading) {
    if (!mapInitialized) return;

    aircraftMarker.setLatLng([lat, lon]);

    // Rotate icon
    aircraftMarker.setIcon(L.divIcon({
        html: `<svg width="24" height="24" viewBox="0 0 24 24" 
                    style="transform: rotate(${heading}deg); transform-origin: center;">
                 <polygon points="12,2 16,22 12,18 8,22" fill="#00ff41" opacity="0.9"/>
               </svg>`,
        iconSize: [24, 24],
        iconAnchor: [12, 12],
        className: ''
    }));

    // Trail
    aircraftTrail.push([lat, lon]);
    if (aircraftTrail.length > 300) aircraftTrail.shift();
    trailLine.setLatLngs(aircraftTrail);

    // Auto-center if first fix
    if (aircraftTrail.length === 1) {
        map.setView([lat, lon], 14);
    }
}

// ─── WAYPOINTS ────────────────────────────────────────────────
function addWaypoint(lat, lon) {
    wpCounter++;
    const idx = window.WAYPOINTS.length;

    window.WAYPOINTS.push({ lat, lon, alt: 100 });

    const wpIcon = L.divIcon({
        html: `<div style="
            color:#00ff41;
            font-family:'Share Tech Mono',monospace;
            font-size:10px;
            background:rgba(0,15,5,0.85);
            border:1px solid #0d3311;
            padding:1px 4px;
            white-space:nowrap;
        ">WP${idx + 1}</div>`,
        iconAnchor: [10, 8],
        className: ''
    });

    const marker = L.marker([lat, lon], { icon: wpIcon }).addTo(map);
    wpMarkers.push(marker);

    renderWpList();
    document.getElementById('bb-wp-count').textContent = `WP: ${window.WAYPOINTS.length}`;
    logMsg(`WP${idx+1} SET: ${lat.toFixed(4)}, ${lon.toFixed(4)}`, 'OK');
}

function renderWpList() {
    const list = document.getElementById('wp-list');
    list.innerHTML = '';
    window.WAYPOINTS.forEach((wp, i) => {
        const row = document.createElement('div');
        row.className = 'wp-item';
        row.innerHTML = `
            <span>WP${i+1}</span>
            <span>${wp.lat.toFixed(4)}, ${wp.lon.toFixed(4)}</span>
            <button class="wp-del" onclick="removeWaypoint(${i})">X</button>
        `;
        list.appendChild(row);
    });
}

function removeWaypoint(idx) {
    map.removeLayer(wpMarkers[idx]);
    wpMarkers.splice(idx, 1);
    window.WAYPOINTS.splice(idx, 1);
    renderWpList();
    document.getElementById('bb-wp-count').textContent = `WP: ${window.WAYPOINTS.length}`;
    logMsg(`WP${idx+1} REMOVED`, 'WARN');
}

function mapClearWaypoints() {
    wpMarkers.forEach(m => map.removeLayer(m));
    wpMarkers = [];
    window.WAYPOINTS = [];
    renderWpList();
    document.getElementById('bb-wp-count').textContent = 'WP: 0';
}

// ─── TARGET MARKER ────────────────────────────────────────────
function placeTargetMarker(lat, lon) {
    if (targetMarker) map.removeLayer(targetMarker);

    const tgtIcon = L.divIcon({
        html: `<svg width="20" height="20" viewBox="0 0 20 20">
                 <circle cx="10" cy="10" r="8" stroke="#ff2222" stroke-width="1" fill="none"/>
                 <line x1="10" y1="2" x2="10" y2="18" stroke="#ff2222" stroke-width="1"/>
                 <line x1="2" y1="10" x2="18" y2="10" stroke="#ff2222" stroke-width="1"/>
                 <circle cx="10" cy="10" r="2" fill="#ff2222"/>
               </svg>`,
        iconSize: [20, 20],
        iconAnchor: [10, 10],
        className: ''
    });

    targetMarker = L.marker([lat, lon], { icon: tgtIcon }).addTo(map);
}

// ─── BOOT ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', initMap);
