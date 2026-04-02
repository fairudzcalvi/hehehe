# Smart Water Tank Monitor — Setup Guide

A local dashboard for monitoring water tank levels using an ESP32 ultrasonic sensor, a Node.js backend, and a SQLite database.

---

## Project Structure

```
├── water-tank-dashboard-lowfi.html   # Frontend dashboard
├── styles.css                        # Dashboard styles
├── api.js                            # Dashboard live polling logic
├── notifications.js                  # Notifications modal logic
├── server.js                         # Node.js backend + API routes
├── package.json                      # Node dependencies
├── water_tank/
│   └── water_tank.ino                # ESP32 Arduino sketch
└── water_tank.db                     # SQLite database (auto-created on first run)
```

---

## How It Works

```
[ESP32 Access Point — WaterTank-ESP32]
        |
        | Your PC connects to ESP32's WiFi
        ↓
[PC runs Node.js server — localhost:3000]
        |
        | ESP32 POSTs sensor data every 5s
        | to http://192.168.4.2:3000/api/water-level
        ↓
[SQLite — water_tank.db]
        |
        | Dashboard polls via REST API
        ↓
[Browser — http://localhost:3000]
```

---

## Step 1 — Install Node.js Dependencies

Make sure you have [Node.js](https://nodejs.org) installed, then run:

```bash
npm install
```

This installs `express` and `sql.js`.

---

## Step 2 — Flash the ESP32

Open `water_tank/water_tank.ino` in the Arduino IDE.

### Board setup (first time only):
1. Go to **File → Preferences**
2. Add to Additional Board Manager URLs:
   `https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json`
3. Go to **Tools → Board → Board Manager**, search `esp32`, install it
4. Select **Tools → Board → ESP32 Dev Module**

### Configure the sketch (optional):
The default AP credentials are already set. Change them if you want:
```cpp
const char* ap_ssid     = "WaterTank-ESP32";
const char* ap_password = "watertank123";
```

Flash the sketch. Open Serial Monitor at **115200 baud**. You should see:
```
[AP] ESP32 Access Point started
[AP] Network : WaterTank-ESP32
[AP] Password: watertank123
[AP] ESP32 IP: 192.168.4.1
[AP] Connect your PC to this network, then run: npm start
```

---

## Step 3 — Connect Your PC to the ESP32 Network

1. On your PC, open **WiFi settings**
2. Connect to the network: `WaterTank-ESP32`
3. Password: `watertank123`

> Your PC will lose internet access while connected to the ESP32 hotspot. This is expected — the dashboard runs fully offline.

The IP addresses on this network are always fixed:
| Device | IP |
|---|---|
| ESP32 | `192.168.4.1` |
| Your PC | `192.168.4.2` |

No need to run `ipconfig` — these never change.

---

## Step 4 — Start the Backend Server

```bash
npm start
```

The server starts at `http://localhost:3000` and automatically creates `water_tank.db` with three tables:

| Table | What it stores |
|---|---|
| `sensor_readings` | Every water level reading from the ESP32 |
| `notifications` | SMS alert log (low, full, test) |
| `thresholds` | Low/high alert settings (persists across restarts) |

---

## Step 5 — Open the Dashboard

```
http://localhost:3000/water-tank-dashboard-lowfi.html
```

The dashboard polls the server every 5 seconds and updates all values live.

---

## Troubleshooting

**`EADDRINUSE: address already in use :::3000`**
Another server instance is already running. Kill it first:
```bash
npx kill-port 3000
```
Then run `npm start` again.

**Serial Monitor shows `[AP] Clients connected: 0` and skips sending**
Your PC isn't connected to the `WaterTank-ESP32` WiFi network yet.

**Dashboard shows `--` for all values**
The server isn't running or the ESP32 hasn't sent data yet. Check that `npm start` is running and the Serial Monitor shows `[HTTP] Sent OK`.

**Sensor shows `-1` or `No reading`**
The ultrasonic sensor isn't getting an echo — check wiring on TRIG (pin 5) and ECHO (pin 18).

---

## Configure Alert Thresholds

On the dashboard under **THRESHOLD SETTINGS**:
- Set the low level threshold (cm) and phone number → click **UPDATE**
- Set the full level threshold (cm) and phone number → click **UPDATE**

These are saved to the database and survive server restarts.

---

## API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/water-level` | ESP32 posts sensor data |
| `GET` | `/api/water-level` | Get latest reading |
| `GET` | `/api/history` | Get last 100 readings |
| `GET` | `/api/notifications` | Get notification log |
| `POST` | `/api/thresholds` | Update alert thresholds |
| `POST` | `/api/test-sms` | Trigger a test SMS log entry |

### Example ESP32 POST body:
```json
{
  "water_level_cm": 65.0,
  "distance_cm": 35.0
}
```

---

## Adding Real SMS (Future — SIM800L not yet connected)

The current prototype does not have a SIM800L module, so no actual SMS is sent. The server only logs alert entries to the `notifications` table in the database when thresholds are crossed.

When the SIM800L is added, update `server.js` at the two alert checks to send a real SMS via your provider:

Recommended providers for the Philippines:
- [Semaphore](https://semaphore.co) — local, simple REST API
- [Twilio](https://twilio.com) — international, free trial available

---

## Default Values

| Setting | Default |
|---|---|
| AP Network name | `WaterTank-ESP32` |
| AP Password | `watertank123` |
| ESP32 IP | `192.168.4.1` |
| PC IP (server) | `192.168.4.2` |
| Low level alert | `20 cm` |
| Full level alert | `90 cm` |
| Tank height | `100 cm` |
| Tank capacity | `1000 L` |
| Poll interval | `5 seconds` |
