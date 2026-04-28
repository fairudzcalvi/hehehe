#include <WiFi.h>
#include <HTTPClient.h>
#include <HardwareSerial.h>

// ============================================================
//  PIN DEFINITIONS
// ============================================================
#define TRIG_PIN   5
#define ECHO_PIN   18

#define SIM_RX     16
#define SIM_TX     17
#define SIM_BAUD   115200

HardwareSerial sim800(2);

// ============================================================
//  WiFi CREDENTIALS
// ============================================================
const char* wifi_ssid     = "Huawei 50 pro mate";
const char* wifi_password = "dikoalamss";
const char* serverURL     = "https://water-tank-mon-system.onrender.com/api/water-level";

// ============================================================
//  TANK DIMENSIONS
// ============================================================
const float DIAMETER_CM      = 25.0;
const float RADIUS_CM        = DIAMETER_CM / 2.0;
const float HEIGHT_CM        = 42.0;
const float MAX_LITERS       = PI * RADIUS_CM * RADIUS_CM * HEIGHT_CM / 1000.0;
const float SENSOR_OFFSET_CM = 3.0;   // gap from sensor face to top of tank — adjust if needed
const float EMPTY_DIST_CM    = SENSOR_OFFSET_CM + HEIGHT_CM;

// ============================================================
//  ALERT THRESHOLDS
// ============================================================
float LOW_THRESHOLD_PCT  = 20.0;
float HIGH_THRESHOLD_PCT = 90.0;
String alertPhone = "+639638476287";

const unsigned long ALERT_COOLDOWN_MS = 1800000UL; // 30 minutes
unsigned long lastLowAlertMs  = 0;
unsigned long lastHighAlertMs = 0;

// ============================================================
//  SIM800L HELPERS
// ============================================================
String sim800SendAT(const char* cmd, unsigned long timeoutMs = 3000) {
  while (sim800.available()) sim800.read();
  sim800.println(cmd);
  String resp = "";
  unsigned long start = millis();
  while (millis() - start < timeoutMs) {
    while (sim800.available()) resp += (char)sim800.read();
    if (resp.indexOf("OK") != -1 || resp.indexOf("ERROR") != -1 || resp.indexOf(">") != -1) break;
  }
  resp.trim();
  Serial.println("[SIM] << " + resp);
  return resp;
}

bool sim800Init() {
  Serial.println("[SIM] Initialising SIM800L...");
  sim800.begin(SIM_BAUD, SERIAL_8N1, SIM_RX, SIM_TX);
  delay(3000);
  for (int i = 0; i < 5; i++) {
    if (sim800SendAT("AT").indexOf("OK") != -1) {
      Serial.println("[SIM] Module ready");
      sim800SendAT("ATE0");
      sim800SendAT("AT+CMGF=1");
      sim800SendAT("AT+CSCS=\"GSM\"");
      return true;
    }
    delay(1000);
  }
  Serial.println("[SIM] Module not responding!");
  return false;
}

bool sendSMS(const String& number, const String& message) {
  Serial.println("[SIM] Sending SMS to " + number);
  String cmd = "AT+CMGS=\"" + number + "\"";
  if (sim800SendAT(cmd.c_str(), 5000).indexOf(">") == -1) {
    Serial.println("[SIM] No prompt received");
    return false;
  }
  sim800.print(message);
  sim800.write(0x1A);
  delay(200);
  String result = "";
  unsigned long start = millis();
  while (millis() - start < 10000) {
    while (sim800.available()) result += (char)sim800.read();
    if (result.indexOf("+CMGS") != -1 || result.indexOf("ERROR") != -1) break;
  }
  result.trim();
  Serial.println("[SIM] << " + result);
  bool ok = result.indexOf("+CMGS") != -1;
  Serial.println(ok ? "[SIM] SMS sent OK" : "[SIM] SMS FAILED");
  return ok;
}

int sim800SignalQuality() {
  String r = sim800SendAT("AT+CSQ");
  int idx = r.indexOf("+CSQ: ");
  if (idx == -1) return -1;
  return r.substring(idx + 6).toInt();
}

// ============================================================
//  ULTRASONIC HELPERS
// ============================================================
float getDistance() {
  float total = 0;
  int valid = 0;
  for (int i = 0; i < 10; i++) {
    digitalWrite(TRIG_PIN, LOW);
    delayMicroseconds(2);
    digitalWrite(TRIG_PIN, HIGH);
    delayMicroseconds(10);
    digitalWrite(TRIG_PIN, LOW);
    long dur = pulseIn(ECHO_PIN, HIGH, 30000);
    if (dur > 0) { total += (dur * 0.0343f) / 2.0f; valid++; }
    delay(50);
  }
  return (valid == 0) ? -1.0f : total / valid;
}

float calcLiters(float water_height_cm) {
  return PI * RADIUS_CM * RADIUS_CM * water_height_cm / 1000.0f;
}

// ============================================================
//  FETCH THRESHOLDS FROM SERVER
// ============================================================
void fetchThresholds() {
  if (WiFi.status() != WL_CONNECTED) return;
  HTTPClient http;
  http.begin("https://water-tank-mon-system.onrender.com/api/thresholds");
  http.setInsecure();
  if (http.GET() == 200) {
    String body = http.getString();
    auto extractFloat = [&](const String& key) -> float {
      int idx = body.indexOf("\"" + key + "\":");
      if (idx == -1) return -1;
      return body.substring(idx + key.length() + 3).toFloat();
    };
    auto extractStr = [&](const String& key) -> String {
      int idx = body.indexOf("\"" + key + "\":\"");
      if (idx == -1) return "";
      idx += key.length() + 4;
      return body.substring(idx, body.indexOf("\"", idx));
    };
    float lp = extractFloat("low_pct");
    float hp = extractFloat("high_pct");
    String ph = extractStr("phone");
    if (lp > 0) LOW_THRESHOLD_PCT = lp;
    if (hp > 0) HIGH_THRESHOLD_PCT = hp;
    if (ph.length() > 0) alertPhone = ph;
    Serial.printf("[Thresholds] low=%.1f%% high=%.1f%% phone=%s\n", LOW_THRESHOLD_PCT, HIGH_THRESHOLD_PCT, alertPhone.c_str());
  }
  http.end();
}

// ============================================================
//  SEND DATA TO SERVER
// ============================================================
void sendToServer(float liters, float pct, float dist_cm) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[WiFi] Not connected, skipping send");
    return;
  }
  HTTPClient http;
  http.begin(serverURL);
  http.setInsecure();
  http.addHeader("Content-Type", "application/json");
  String payload = "{\"liters\":"      + String(liters, 2) +
                   ",\"percentage\":"  + String(pct, 1) +
                   ",\"distance_cm\":" + String(dist_cm, 1) +
                   ",\"max_liters\":"  + String(MAX_LITERS, 2) + "}";
  int code = http.POST(payload);
  Serial.println(code == 200 ? "[HTTP] Sent OK" : "[HTTP] Failed, code: " + String(code));
  http.end();
}

// ============================================================
//  ALERT LOGIC
// ============================================================
void checkAndAlert(float pct, float liters) {
  unsigned long now = millis();
  if (pct <= LOW_THRESHOLD_PCT) {
    if (now - lastLowAlertMs >= ALERT_COOLDOWN_MS) {
      String msg = "ALERT: Water tank LOW!\nLevel: " + String(pct, 1) + "%\nVolume: " + String(liters, 2) + " / " + String(MAX_LITERS, 2) + " L\nPlease refill the tank.";
      if (sendSMS(alertPhone, msg)) lastLowAlertMs = now;
    } else Serial.println("[Alert] LOW — cooldown active, SMS skipped");
  } else if (pct >= HIGH_THRESHOLD_PCT) {
    if (now - lastHighAlertMs >= ALERT_COOLDOWN_MS) {
      String msg = "ALERT: Water tank FULL!\nLevel: " + String(pct, 1) + "%\nVolume: " + String(liters, 2) + " / " + String(MAX_LITERS, 2) + " L\nPlease stop filling.";
      if (sendSMS(alertPhone, msg)) lastHighAlertMs = now;
    } else Serial.println("[Alert] FULL — cooldown active, SMS skipped");
  }
}

// ============================================================
//  SETUP
// ============================================================
void setup() {
  Serial.begin(115200);
  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);

  sim800Init();

  WiFi.mode(WIFI_STA);
  WiFi.begin(wifi_ssid, wifi_password);
  Serial.print("\n[WiFi] Connecting to " + String(wifi_ssid));
  while (WiFi.status() != WL_CONNECTED) { delay(500); Serial.print("."); }
  Serial.println("\n[WiFi] Connected! IP: " + WiFi.localIP().toString());

  Serial.printf("[Tank] Diameter: %.1f cm | Height: %.1f cm | Max: %.2f L\n", DIAMETER_CM, HEIGHT_CM, MAX_LITERS);
  Serial.printf("[Tank] Empty dist: %.1f cm | Offset: %.1f cm\n", EMPTY_DIST_CM, SENSOR_OFFSET_CM);
  Serial.println("====== Monitoring started ======");

  fetchThresholds();
}

// ============================================================
//  LOOP
// ============================================================
static unsigned long lastThresholdFetch = 0;
const  unsigned long THRESHOLD_FETCH_MS = 60000UL;

void loop() {
  if (millis() - lastThresholdFetch >= THRESHOLD_FETCH_MS) {
    fetchThresholds();
    lastThresholdFetch = millis();
  }

  float dist = getDistance();
  if (dist < 0) { Serial.println("[Sensor] Out of range"); delay(2000); return; }

  float water_height = constrain(EMPTY_DIST_CM - dist, 0.0f, HEIGHT_CM);
  float liters = constrain(calcLiters(water_height), 0.0f, MAX_LITERS);
  float pct    = constrain((liters / MAX_LITERS) * 100.0f, 0.0f, 100.0f);
  int rssi = sim800SignalQuality();

  Serial.println("====== WATER LEVEL ======");
  Serial.printf("Distance     : %.1f cm\n", dist);
  Serial.printf("Water Height : %.1f cm\n", water_height);
  Serial.printf("Volume       : %.2f / %.2f L\n", liters, MAX_LITERS);
  Serial.printf("Fill         : %.1f%%\n", pct);
  Serial.printf("GSM Signal   : %d\n", rssi);
  Serial.println(pct < LOW_THRESHOLD_PCT ? "*** WARNING: LOW WATER! ***" : pct > HIGH_THRESHOLD_PCT ? "*** WARNING: NEARLY FULL! ***" : "Status: OK");
  Serial.println();

  sendToServer(liters, pct, dist);
  checkAndAlert(pct, liters);

  delay(5000);
}
