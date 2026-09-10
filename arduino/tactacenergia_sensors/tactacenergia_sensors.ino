#include <OneWire.h>
#include <DallasTemperature.h>

// MKR WiFi 1010 labels these digital pins as 5 (temperature) and 2 (distance).
constexpr uint8_t TEMPERATURE_PIN = 5;
constexpr uint8_t DISTANCE_PIN = 2;
constexpr unsigned long SAMPLE_INTERVAL_MS = 500;

OneWire oneWire(TEMPERATURE_PIN);
DallasTemperature temperatureSensor(&oneWire);
unsigned long lastSampleAt = 0;

float readDistanceCm() {
  pinMode(DISTANCE_PIN, OUTPUT);
  digitalWrite(DISTANCE_PIN, LOW);
  delayMicroseconds(2);
  digitalWrite(DISTANCE_PIN, HIGH);
  delayMicroseconds(10);
  digitalWrite(DISTANCE_PIN, LOW);

  pinMode(DISTANCE_PIN, INPUT);
  unsigned long duration = pulseIn(DISTANCE_PIN, HIGH, 30000);
  return duration == 0 ? -1.0f : duration / 58.0f;
}

void printNumberOrNull(float value, float invalidValue) {
  if (value == invalidValue) {
    Serial.print(F("null"));
  } else {
    Serial.print(value, 1);
  }
}

void setup() {
  Serial.begin(115200);
  temperatureSensor.begin();
  temperatureSensor.setResolution(10);
}

void loop() {
  unsigned long now = millis();
  if (now - lastSampleAt < SAMPLE_INTERVAL_MS) return;
  lastSampleAt = now;

  temperatureSensor.requestTemperatures();
  float temperatureC = temperatureSensor.getTempCByIndex(0);
  float distanceCm = readDistanceCm();

  Serial.print(F("{\"temperatureC\":"));
  printNumberOrNull(temperatureC, DEVICE_DISCONNECTED_C);
  Serial.print(F(",\"distanceCm\":"));
  printNumberOrNull(distanceCm, -1.0f);
  Serial.println(F("}"));
}
