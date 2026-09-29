#!/usr/bin/env python3
from pathlib import Path
import re


firmware = Path(__file__).parents[1] / "ELOTO_FIXED" / "ELOTO_FIXED.ino"
source = firmware.read_text(encoding="utf-8-sig")

for forbidden in (
    "#include <WiFiUdp.h>",
    "WiFiUDP ",
    "setInsecure(",
    "Access-Control-Allow-Origin",
    "http.begin(client",
    "server_host = WiFi.gatewayIP()",
    'String wifi_ssid        = "vivoV29"',
    "DEFAULT_WIFI_SSID",
    "DEFAULT_WIFI_PASSWORD",
    "DEFAULT_SERVER_HOST",
    "192.168.137.104",
    "AT+CGNSCMD=0",
):
    assert forbidden not in source, f"forbidden firmware pattern returned: {forbidden}"

for required in (
    '#include "../FirmwareSafety.h"',
    "class ServerHttpClient",
    "secureClient.setCACert(server_ca.c_str())",
    "eloto::parseServerEndpoint",
    "eloto::parseOfflineRecord",
    "eloto::validSessionBounds",
    "statusRequestAuthorized",
    'server.collectHeaders(statusHeaders, 1)',
    "wifiConnectInProgress",
    "Preferences preferences;",
    "loadDeviceToken();",
    'preferences.putString("device-token", device_token)',
    'const char *jsonConfigPaths[] = {"/config.json", "/SD_CARD_CONFIG/config.json"};',
    "loadJsonConfig(File &configFile)",
    'lowerName.endsWith("config.json.txt")',
    'Serial.printf("[CONFIG] SD entry: %s\\n", candidateName.c_str())',
    "loadNetworkConfig();",
    'preferences.begin("eloto-network", false)',
    'preferences.putString("wifi-ssid", wifi_ssid)',
    "const unsigned long GPS_POLL_TIMEOUT = 700;",
    'kirimPerintahAT("AT+CGNSPWR=1", 1500);',
    'kirimPerintahAT("AT+CGNSSEQ=\\"RMC\\"", 1000);',
    "bool hasGpsData = gpsResponseBuffer.indexOf(\"+CGNSINF:\") >= 0;",
    "if (hasGpsData && (responseComplete || timeout)) parseGpsResponse(gpsResponseBuffer);",
    "syncDatabaseToSDCard();\n                vTaskDelay(pdMS_TO_TICKS(1));\n                uploadOfflineLogsSDCard();",
):
    assert required in source, f"required firmware mitigation missing: {required}"

for loop_pattern in (
    r"for \(JsonObject u : arr\) \{.{0,300}?vTaskDelay\(pdMS_TO_TICKS\(1\)\);",
    r"while \(logFile\.available\(\)\) \{.{0,200}?vTaskDelay\(pdMS_TO_TICKS\(1\)\);",
):
    assert re.search(loop_pattern, source, re.DOTALL), "NetworkTask loop can starve IDLE0"

assert source.count("ServerHttpClient http;") == 5
assert source.count("X-Device-Token") == 7
print("Firmware source security checks passed.")
