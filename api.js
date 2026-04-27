const API_BASE = '/api';
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

function updateAlert(pct, lowThreshold, highThreshold) {
    const alertMsg = el('alert-message');
    if (pct <= lowThreshold) {
        alertMsg.textContent = `⚠ Water level LOW — ${pct}% (threshold: ${lowThreshold}%)`;
        alertMsg.style.color = '#856404';
    } else if (pct >= highThreshold) {
        alertMsg.textContent = `⚠ Water level FULL — ${pct}% (threshold: ${highThreshold}%)`;
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
        const level_pct = Math.min(100, Math.max(0, parseFloat(data.percentage))).toFixed(1);
        const liters = parseFloat(data.liters);
        const max_liters = parseFloat(data.max_liters);

        // Tank visual
        el('water-level-bar').style.height = level_pct + '%';
        el('level-percentage').textContent = level_pct + '%';

        // Metrics
        el('current-level').textContent = level_pct + '%';
        el('water-volume').textContent = liters.toFixed(2) + ' L';
        el('sensor-reading').textContent = distance_cm + ' cm';

        // Min / Max today (track by liters)
        if (liters < todayMin) { todayMin = liters; el('min-today').textContent = todayMin.toFixed(2) + ' L'; }
        if (liters > todayMax) { todayMax = liters; el('max-today').textContent = todayMax.toFixed(2) + ' L'; }

        // Last update time
        const t = new Date(data.timestamp);
        el('last-update').textContent = t.toLocaleTimeString();

        // Alerts (percentage-based)
        const lowThreshold = parseFloat(el('low-threshold').value) || 20;
        const highThreshold = parseFloat(el('high-threshold').value) || 90;
        updateAlert(parseFloat(level_pct), lowThreshold, highThreshold);

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
                <td>${parseFloat(entry.percentage).toFixed(1)}%</td>
                <td>${parseFloat(entry.liters).toFixed(2)} L</td>
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
const btnMap = {
    'update-low':       () => updateThreshold('low'),
    'update-high':      () => updateThreshold('high'),
    'btn-test-sms':     sendTestSms,
    'btn-refresh':      () => { fetchWaterLevel(); fetchHistory(); },
    'btn-reset-alerts': resetAlerts,
    'btn-calibrate':    () => alert('Send calibration command via Serial Monitor on the ESP32.')
};
Object.entries(btnMap).forEach(([id, handler]) => {
    const elem = el(id);
    if (elem) elem.addEventListener('click', handler);
});

// --- Start polling ---
fetchWaterLevel();
fetchHistory();
setInterval(fetchWaterLevel, POLL_INTERVAL);
setInterval(fetchHistory, POLL_INTERVAL * 2);

// Add to existing api.js

// --- Fetch GSM Signal Status ---
async function fetchGSMSignal() {
    try {
        const res = await fetch(`${API_BASE}/gsm-signal`);
        const data = await res.json();
        
        const signalEl = document.getElementById('gsm-signal-header');
        const signalCardEl = document.getElementById('gsm-signal-card');
        
        let signalText = 'Unknown';
        let signalColor = 'gray';
        
        if (data.rssi >= 0) {
            if (data.rssi >= 20) { signalText = 'Excellent'; signalColor = 'green'; }
            else if (data.rssi >= 15) { signalText = 'Good'; signalColor = '#90be6d'; }
            else if (data.rssi >= 10) { signalText = 'Fair'; signalColor = '#f9c74f'; }
            else if (data.rssi >= 5) { signalText = 'Poor'; signalColor = '#f9844a'; }
            else { signalText = 'Very Poor'; signalColor = '#f94144'; }
            signalText += ` (${data.rssi})`;
        } else {
            signalText = 'No Signal';
            signalColor = 'red';
        }
        
        if (signalEl) {
            signalEl.textContent = signalText;
            signalEl.style.color = signalColor;
        }
        if (signalCardEl) {
            signalCardEl.textContent = signalText;
            signalCardEl.style.color = signalColor;
        }
    } catch (error) {
        console.log('GSM signal fetch failed:', error);
    }
}

// --- Fetch SMS Log ---
async function fetchSMSLog() {
    try {
        const res = await fetch(`${API_BASE}/sms-log`);
        const smsLog = await res.json();
        const tbody = document.getElementById('sms-log');
        
        if (!tbody) return;
        tbody.innerHTML = '';
        
        if (smsLog.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:#999;">No SMS records found</td></tr>';
            return;
        }
        
        smsLog.slice(0, 20).forEach(entry => {
            const tr = document.createElement('tr');
            const t = new Date(entry.timestamp).toLocaleString();
            const statusClass = entry.status === 'SENT' ? 'status-sent' : 'status-failed';
            const statusText = entry.status === 'SENT' ? '✓ Sent' : (entry.status === 'FAILED' ? '✗ Failed' : entry.status);
            
            tr.innerHTML = `
                <td>${t}</td>
                <td>${entry.type || 'SMS'}</td>
                <td>${entry.recipient || '--'}</td>
                <td style="max-width: 300px; word-break: break-word;">${entry.message || '--'}</td>
                <td class="${statusClass}">${statusText}</td>
            `;
            tbody.appendChild(tr);
        });
    } catch (error) {
        console.log('SMS log fetch failed:', error);
    }
}

// --- Check GSM Signal (trigger from button) ---
async function checkGSMSignal() {
    try {
        const res = await fetch(`${API_BASE}/gsm-signal`);
        const data = await res.json();
        
        let signalText = '';
        if (data.rssi >= 0) {
            if (data.rssi >= 20) signalText = 'Excellent';
            else if (data.rssi >= 15) signalText = 'Good';
            else if (data.rssi >= 10) signalText = 'Fair';
            else if (data.rssi >= 5) signalText = 'Poor';
            else signalText = 'Very Poor';
            alert(`GSM Signal: ${signalText} (${data.rssi})\nLast updated: ${new Date(data.timestamp).toLocaleString() || 'Never'}`);
        } else {
            alert('GSM Signal: No signal detected!\nCheck SIM card and antenna.');
        }
    } catch {
        alert('Could not fetch GSM signal. Is the ESP32 connected?');
    }
}

// --- Update SMS Count in summary card ---
async function updateSMSCount() {
    try {
        const res = await fetch(`${API_BASE}/notifications`);
        const notifications = await res.json();
        const today = new Date().toISOString().split('T')[0];
        const todaySMS = notifications.filter(n => n.timestamp.startsWith(today) && (n.type === 'Low Alert' || n.type === 'Full Alert' || n.type === 'System' || n.type === 'Test SMS'));
        
        const smsCountEl = document.getElementById('sms-count');
        if (smsCountEl) smsCountEl.textContent = todaySMS.length;
        
        const lastSMS = notifications.find(n => n.type === 'Low Alert' || n.type === 'Full Alert' || n.type === 'Test SMS');
        const lastSMSEl = document.getElementById('last-sms');
        if (lastSMSEl && lastSMS) {
            lastSMSEl.textContent = new Date(lastSMS.timestamp).toLocaleTimeString();
        }
        
        const lastStatusEl = document.getElementById('last-sms-status');
        if (lastStatusEl && lastSMS) {
            lastStatusEl.textContent = lastSMS.status === 'SENT' ? '✓ Last SMS Sent' : (lastSMS.status === 'FAILED' ? '✗ Last SMS Failed' : '--');
            lastStatusEl.style.color = lastSMS.status === 'SENT' ? 'green' : 'red';
        }
    } catch (error) {
        console.log('SMS count fetch failed:', error);
    }
}

// --- Update thresholds to use percentage (from server) ---
async function loadThresholds() {
    try {
        const res = await fetch(`${API_BASE}/thresholds`);
        const thresholds = await res.json();
        
        const lowInput = document.getElementById('low-threshold');
        const highInput = document.getElementById('high-threshold');
        
        if (lowInput && thresholds.low_pct) lowInput.value = thresholds.low_pct;
        if (highInput && thresholds.high_pct) highInput.value = thresholds.high_pct;
        
        // Also load phone numbers if stored separately
        if (thresholds.phone) {
            const lowPhone = document.getElementById('low-phone');
            const highPhone = document.getElementById('high-phone');
            if (lowPhone) lowPhone.value = thresholds.phone;
            if (highPhone) highPhone.value = thresholds.phone;
        }
    } catch (error) {
        console.log('Load thresholds failed:', error);
    }
}

// --- Update thresholds with percentage values ---
async function updateThreshold(type) {
    const threshold = document.getElementById(`${type}-threshold`).value;
    const phone = document.getElementById(`${type}-phone`).value;

    try {
        const res = await fetch(`${API_BASE}/thresholds`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type, threshold: parseFloat(threshold), phone })
        });
        const data = await res.json();
        alert(data.message || 'Threshold updated successfully!\nESP32 will fetch new values within 60 seconds.');
        loadThresholds(); // Refresh display
    } catch {
        alert('Failed to update threshold — is the server running?');
    }
}

// --- Override existing functions ---
// Replace the old updateThreshold with this enhanced version
window.updateThreshold = updateThreshold;

// Add new button handlers
document.addEventListener('DOMContentLoaded', () => {
    const checkSignalBtn = document.getElementById('btn-check-signal');
    if (checkSignalBtn) {
        checkSignalBtn.addEventListener('click', checkGSMSignal);
    }
    
    const testSmsCardBtn = document.getElementById('btn-test-sms-card');
    if (testSmsCardBtn) {
        testSmsCardBtn.addEventListener('click', sendTestSms);
    }
    
    // Load thresholds on page load
    loadThresholds();
    
    // Start fetching GSM signal and SMS log
    fetchGSMSignal();
    fetchSMSLog();
    updateSMSCount();
    
    // Add to polling intervals
    setInterval(fetchGSMSignal, 30000); // Every 30 seconds
    setInterval(fetchSMSLog, 15000);    // Every 15 seconds
    setInterval(updateSMSCount, 10000);  // Every 10 seconds
});
