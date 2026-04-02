const express = require('express');
const path = require('path');
const fs = require('fs');
const initSqlJs = require('sql.js');

const app = express();
app.use(express.json());
app.use(express.static('.'));

const DB_PATH = path.join(__dirname, 'water_tank.db');

let db;

// --- Init database ---
async function initDb() {
    const SQL = await initSqlJs();

    // Load existing DB file if it exists, otherwise create fresh
    if (fs.existsSync(DB_PATH)) {
        const fileBuffer = fs.readFileSync(DB_PATH);
        db = new SQL.Database(fileBuffer);
    } else {
        db = new SQL.Database();
    }

    db.run(`
        CREATE TABLE IF NOT EXISTS sensor_readings (
            id             INTEGER PRIMARY KEY AUTOINCREMENT,
            water_level_cm REAL NOT NULL,
            distance_cm    REAL NOT NULL,
            event_type     TEXT DEFAULT 'Level Update',
            action         TEXT DEFAULT 'Reading logged',
            status         TEXT DEFAULT 'OK',
            timestamp      TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS notifications (
            id        INTEGER PRIMARY KEY AUTOINCREMENT,
            type      TEXT NOT NULL,
            message   TEXT NOT NULL,
            recipient TEXT NOT NULL,
            status    TEXT DEFAULT 'SENT',
            timestamp TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS thresholds (
            id      INTEGER PRIMARY KEY CHECK (id = 1),
            low_cm  REAL DEFAULT 20,
            high_cm REAL DEFAULT 90,
            phone   TEXT DEFAULT '+639123456789'
        );
        INSERT OR IGNORE INTO thresholds (id, low_cm, high_cm, phone)
        VALUES (1, 20, 90, '+639123456789');
    `);

    saveDb();
    console.log('Database ready:', DB_PATH);
}

// --- Persist DB to disk after every write ---
function saveDb() {
    const data = db.export();
    fs.writeFileSync(DB_PATH, Buffer.from(data));
}

// --- Helpers ---
function getThresholds() {
    const res = db.exec('SELECT * FROM thresholds WHERE id = 1');
    if (!res.length) return { low_cm: 20, high_cm: 90, phone: '+639123456789' };
    const [id, low_cm, high_cm, phone] = res[0].values[0];
    return { id, low_cm, high_cm, phone };
}

function rowsToObjects(result) {
    if (!result.length) return [];
    const { columns, values } = result[0];
    return values.map(row =>
        Object.fromEntries(columns.map((col, i) => [col, row[i]]))
    );
}

// --- ESP32 posts sensor data here ---
app.post('/api/water-level', (req, res) => {
    const { water_level_cm, distance_cm } = req.body;
    const t = getThresholds();
    const level = parseFloat(water_level_cm);
    const timestamp = new Date().toISOString();

    let event_type = 'Level Update';
    let action = 'Reading logged';
    let status = 'OK';

    if (level <= t.low_cm) {
        event_type = 'Low Alert';
        action = 'Alert Logged';
        status = 'ALERT';
        db.run('INSERT INTO notifications (type, message, recipient, status, timestamp) VALUES (?,?,?,?,?)',
            ['Low Alert', `Water level critically low at ${level} cm`, t.phone, 'SENT', timestamp]);
        console.log(`[ALERT] Low water: ${level} cm — alert logged (no SMS yet)`);
    } else if (level >= t.high_cm) {
        event_type = 'Full Alert';
        action = 'Alert Logged';
        status = 'ALERT';
        db.run('INSERT INTO notifications (type, message, recipient, status, timestamp) VALUES (?,?,?,?,?)',
            ['Full Alert', `Water tank nearly full at ${level} cm`, t.phone, 'SENT', timestamp]);
        console.log(`[ALERT] Tank full: ${level} cm — alert logged (no SMS yet)`);
    }

    db.run('INSERT INTO sensor_readings (water_level_cm, distance_cm, event_type, action, status, timestamp) VALUES (?,?,?,?,?,?)',
        [level.toFixed(1), parseFloat(distance_cm).toFixed(1), event_type, action, status, timestamp]);

    saveDb();
    console.log(`[${new Date().toLocaleTimeString()}] Level: ${level} cm`);
    res.json({ status: 'ok' });
});

// --- Latest reading ---
app.get('/api/water-level', (_req, res) => {
    const result = db.exec('SELECT * FROM sensor_readings ORDER BY id DESC LIMIT 1');
    const rows = rowsToObjects(result);
    res.json(rows[0] || null);
});

// --- History ---
app.get('/api/history', (_req, res) => {
    const result = db.exec('SELECT * FROM sensor_readings ORDER BY id DESC LIMIT 100');
    res.json(rowsToObjects(result));
});

// --- Notifications ---
app.get('/api/notifications', (_req, res) => {
    const result = db.exec('SELECT * FROM notifications ORDER BY id DESC LIMIT 100');
    res.json(rowsToObjects(result));
});

// --- Update thresholds ---
app.post('/api/thresholds', (req, res) => {
    const { type, threshold, phone } = req.body;
    const current = getThresholds();
    const low_cm  = type === 'low'  ? threshold : current.low_cm;
    const high_cm = type === 'high' ? threshold : current.high_cm;
    const newPhone = phone || current.phone;
    db.run('UPDATE thresholds SET low_cm = ?, high_cm = ?, phone = ? WHERE id = 1',
        [low_cm, high_cm, newPhone]);
    saveDb();
    console.log('[Thresholds updated]', { low_cm, high_cm, phone: newPhone });
    res.json({ message: `${type} threshold set to ${threshold} cm` });
});

// --- Test SMS ---
app.post('/api/test-sms', (_req, res) => {
    const t = getThresholds();
    const timestamp = new Date().toISOString();
    db.run('INSERT INTO notifications (type, message, recipient, status, timestamp) VALUES (?,?,?,?,?)',
        ['System', 'Test SMS from dashboard', t.phone, 'SENT', timestamp]);
    saveDb();
    console.log(`[TEST SMS] Sent to ${t.phone}`);
    res.json({ message: `Test SMS sent to ${t.phone}` });
});

const PORT = 3000;
initDb().then(() => {
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`\nServer running at http://localhost:${PORT}`);
        console.log(`Dashboard: http://localhost:${PORT}/water-tank-dashboard-lowfi.html\n`);
    });
});
