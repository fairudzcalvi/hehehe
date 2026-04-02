const API_BASE = 'http://localhost:3000/api';
const TANK_HEIGHT_CM = 100;
const TANK_CAPACITY_L = 1000;
const POLL_INTERVAL = 5000;

let todayMin = Infinity;
let todayMax = -Infinity;

// --- DOM helpers ---
const el = (id) => document.getElementById(id);

function setStatus(online) {
    el('system-status').textContent = online ? 'ONLINE' : 'OFFLINE';
    el('system-status').style.color = online ? 'green' : 'red';
    el('server-status').textContent = online ? 'Connected' : 'Disconnected';
    el('server-status').style.color = online ? 'green' : 'red';
    el('sensor-status').textContent = online ? 'ACTIVE' : 'NO SIGNAL';
}

function updateAlert(level_cm, lowThreshold, highThreshold) {
    const alertMsg = el('alert-message');
    if (level_cm <= lowThreshold) {
        alertMsg.textContent = `⚠ Water level LOW — ${level_cm} cm (threshold: ${lowThreshold} cm)`;
        alertMsg.style.color = '#856404';
    } else if (level_cm >= highThreshold) {
        alertMsg.textContent = `⚠ Water level FULL — ${level_cm} cm (threshold: ${highThreshold} cm)`;
        alertMsg.style.color = '#0c5460';
    } else {
        alertMsg.textContent = 'No active alerts';
        alertMsg.style.color = '';
    }
}

// --- Fetch latest reading ---
async function fetchWaterLevel() {
    try {
        const res = await fetch(`${API_BASE}/water-level`);
        if (!res.ok) throw new Error('Bad response');
        const data = await res.json();

        if (!data.timestamp) return;

        const distance_cm = parseFloat(data.distance_cm);
        const water_level_cm = parseFloat(data.water_level_cm);
        const level_pct = Math.min(100, Math.max(0, (water_level_cm / TANK_HEIGHT_CM) * 100)).toFixed(1);
        const volume = Math.round((water_level_cm / TANK_HEIGHT_CM) * TANK_CAPACITY_L);

        // Tank visual
        el('water-level-bar').style.height = level_pct + '%';
        el('level-percentage').textContent = level_pct + '%';

        // Metrics
        el('current-level').textContent = water_level_cm + ' cm';
        el('water-volume').textContent = volume + ' L';
        el('sensor-reading').textContent = distance_cm + ' cm';

        // Min / Max today
        if (water_level_cm < todayMin) { todayMin = water_level_cm; el('min-today').textContent = todayMin + ' cm'; }
        if (water_level_cm > todayMax) { todayMax = water_level_cm; el('max-today').textContent = todayMax + ' cm'; }

        // Last update time
        const t = new Date(data.timestamp);
        el('last-update').textContent = t.toLocaleTimeString();

        // Alerts
        const lowThreshold = parseInt(el('low-threshold').value) || 20;
        const highThreshold = parseInt(el('high-threshold').value) || 90;
        updateAlert(water_level_cm, lowThreshold, highThreshold);

        setStatus(true);
    } catch {
        setStatus(false);
    }
}

// --- Fetch activity log ---
async function fetchHistory() {
    try {
        const res = await fetch(`${API_BASE}/history`);
        const history = await res.json();
        const tbody = el('activity-log');
        tbody.innerHTML = '';

        history.slice(0, 10).forEach(entry => {
            const tr = document.createElement('tr');
            const t = new Date(entry.timestamp).toLocaleString();
            tr.innerHTML = `
                <td>${t}</td>
                <td>${entry.event_type || 'Level Update'}</td>
                <td>${entry.water_level_cm} cm</td>
                <td>${entry.action || 'Reading logged'}</td>
                <td>${entry.status || 'OK'}</td>
            `;
            tbody.appendChild(tr);
        });
    } catch { /* server not ready yet */ }
}

// --- Threshold update ---
async function updateThreshold(type) {
    const threshold = el(`${type}-threshold`).value;
    const phone = el(`${type}-phone`).value;

    try {
        const res = await fetch(`${API_BASE}/thresholds`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type, threshold: parseInt(threshold), phone })
        });
        const data = await res.json();
        alert(data.message || 'Threshold updated');
    } catch {
        alert('Failed to update threshold — is the server running?');
    }
}

// --- Manual action buttons ---
async function sendTestSms() {
    try {
        const res = await fetch(`${API_BASE}/test-sms`, { method: 'POST' });
        const data = await res.json();
        alert(data.message || 'Test SMS sent');
    } catch { alert('Failed — is the server running?'); }
}

async function resetAlerts() {
    el('alert-message').textContent = 'No active alerts';
    el('alert-message').style.color = '';
    alert('Alerts reset');
}

// --- Wire up buttons ---
el('update-low').addEventListener('click', () => updateThreshold('low'));
el('update-high').addEventListener('click', () => updateThreshold('high'));
el('btn-test-sms').addEventListener('click', sendTestSms);
el('btn-refresh').addEventListener('click', () => { fetchWaterLevel(); fetchHistory(); });
el('btn-reset-alerts').addEventListener('click', resetAlerts);
el('btn-calibrate').addEventListener('click', () => alert('Send calibration command via Serial Monitor on the ESP32.'));

// --- Start polling ---
fetchWaterLevel();
fetchHistory();
setInterval(fetchWaterLevel, POLL_INTERVAL);
setInterval(fetchHistory, POLL_INTERVAL * 2);
