#include <WiFi.h>
#include <HTTPClient.h>

#define TRIG_PIN 5
#define ECHO_PIN 18

// --- ESP32 Access Point credentials (you choose these) ---
const char* ap_ssid     = "WaterTank-ESP32";
const char* ap_password = "watertank123";

// --- Your PC's IP on the ESP32 AP network is always 192.168.4.2 ---
// (ESP32 AP gateway is 192.168.4.1, first connected device gets .2)
const char* serverURL = "http://192.168.4.2:3000/api/water-level";

// --- Tank config ---
const float TANK_HEIGHT_CM = 100.0;

long duration;
float distance_cm;
float tank_height_cm = 0;

float getDistance() {
    digitalWrite(TRIG_PIN, LOW);
    delayMicroseconds(2);
    digitalWrite(TRIG_PIN, HIGH);
    delayMicroseconds(10);
    digitalWrite(TRIG_PIN, LOW);

    duration = pulseIn(ECHO_PIN, HIGH, 30000);
    if (duration == 0) return -1;

    return (duration * 0.0343) / 2.0;
}

void sendToServer(float water_level_cm, float dist_cm) {
    if (WiFi.softAPgetStationNum() == 0) {
        Serial.println("[AP] No clients connected, skipping send");
        return;
    }

    HTTPClient http;
    http.begin(serverURL);
    http.addHeader("Content-Type", "application/json");

    String payload = "{\"water_level_cm\":" + String(water_level_cm, 1) +
                     ",\"distance_cm\":"    + String(dist_cm, 1) + "}";

    int httpCode = http.POST(payload);

    if (httpCode == 200) {
        Serial.println("[HTTP] Sent OK");
    } else {
        Serial.printf("[HTTP] Failed, code: %d\n", httpCode);
    }

    http.end();
}

void setup() {
    Serial.begin(115200);
    pinMode(TRIG_PIN, OUTPUT);
    pinMode(ECHO_PIN, INPUT);

    // Start ESP32 as Access Point
    WiFi.mode(WIFI_AP);
    WiFi.softAP(ap_ssid, ap_password);

    Serial.println("\n[AP] ESP32 Access Point started");
    Serial.println("[AP] Network : " + String(ap_ssid));
    Serial.println("[AP] Password: " + String(ap_password));
    Serial.println("[AP] ESP32 IP: " + WiFi.softAPIP().toString());
    Serial.println("[AP] Connect your PC to this network, then run: npm start");
    Serial.println("[AP] Waiting for PC to connect...");

    // Calibrate sensor
    delay(2000);
    float sample = getDistance();
    if (sample > 0) {
        tank_height_cm = sample;
        Serial.printf("[Sensor] Calibrated: empty tank = %.1f cm\n", tank_height_cm);
    } else {
        tank_height_cm = TANK_HEIGHT_CM;
        Serial.println("[Sensor] Calibration failed, using default: " + String(TANK_HEIGHT_CM) + " cm");
    }
}

void loop() {
    // Print connected clients count
    int clients = WiFi.softAPgetStationNum();
    Serial.printf("[AP] Clients connected: %d\n", clients);

    distance_cm = getDistance();

    if (distance_cm < 0) {
        Serial.println("[Sensor] No reading");
        delay(5000);
        return;
    }

    float water_level_cm = tank_height_cm - distance_cm;
    water_level_cm = constrain(water_level_cm, 0, tank_height_cm);

    Serial.printf("[Sensor] Distance: %.1f cm | Water Level: %.1f cm | %.1f%%\n",
        distance_cm, water_level_cm, (water_level_cm / tank_height_cm) * 100.0);

    sendToServer(water_level_cm, distance_cm);

    delay(5000);
}
