#!/usr/bin/env python3
from pathlib import Path
import re


firmware = Path(__file__).parents[1] / "ELOTO_FIXED" / "ELOTO_FIXED.ino"
source = firmware.read_text(encoding="utf-8-sig")
repo = Path(__file__).parents[2]
defaults = (repo / "esp32/ServerDefaults.h").read_text(encoding="utf-8")

assert 'DEFAULT_SERVER_BASE[] = "http://192.168.137.1:5002/"' in defaults
assert "LOCAL_ONLY_MODE = true" in defaults
assert "103.197.188.61" not in defaults

required = (
    '#include "../FirmwareSafety.h"',
    "class ServerHttpClient {",
    "secureClient.setCACert(server_ca.c_str())",
    "request.begin(secureClient, url)",
    "request.begin(localClient, url)",
    "request.setFollowRedirects(HTTPC_DISABLE_FOLLOW_REDIRECTS)",
    "eloto::parseServerEndpoint(value.c_str(), candidate)",
    'SD.open("/server_ca.pem", FILE_READ)',
    "bool verifyConfiguredServer()",
    'response[\"data\"][\"contract\"]',
    'response[\"data\"][\"id_box\"]',
    'server_host = configured_server_base;',
    'if __has_include("network_secrets.local.h")',
    'if __has_include("device_secrets.override.h")',
    "automatic subnet scanning is disabled",
    'http.addHeader("X-Device-Id", getDeviceId());',
    "WiFi.setAutoReconnect(true);",
    "secureClient.lastError(error, sizeof(error))",
    "BACKEND_DISCOVERY_RETRY_MS",
)
for marker in required:
    assert marker in source, f"required active firmware mitigation missing: {marker}"

device_id_header = 'addHeader("X-Device-Id", getDeviceId());'
assert source.count(device_id_header) == 8 and 'addHeader("X-Device-Id", device_id);' not in source, (
    "all authenticated requests must use the same resolved device ID"
)

transport = source.split("class ServerHttpClient {", 1)[1].split("};", 1)[0]
assert transport.index("ElotoSecureClient secureClient;") < transport.index("HTTPClient request;"), (
    "HTTPClient must be destroyed before its referenced network clients"
)

for forbidden in (
    "setInsecure(",
    "http.begin(client",
    "WiFiClient client;\n    if (!client.connect",
    "probeElotoServer(",
    "DISCOVERY_PROBES_PER_PASS",
    "configuredServerIp",
    "192.168.137.104",
    'Access-Control-Allow-Origin',
):
    assert forbidden not in source, f"unsafe or stale firmware path returned: {forbidden}"

assert source.count("ServerHttpClient http;") == 7
assert "WorkerInfo cachedCard = searchUserFromSDCard(uid, decimalPadded, decimalUnpadded)" in source
assert 'const char *active = "/pending_cards.csv";' in source
assert '"/pending-cards"' in source
assert "queuePendingRfidCardToSD(uid)" in source

main_loop = source.split("void loop() {", 1)[1].split("void getLcdText", 1)[0]
assert "\n    serviceCountdown();\n" in main_loop, (
    "the non-blocking countdown must be serviced from the main loop"
)
assert "currentState == STATE_CONNECTING" in main_loop
assert "wifiUiConnectStartedAt" in main_loop

countdown_start = source.split("void startCountdown(bool closingSession) {", 1)[1].split(
    "void serviceCountdown()", 1
)[0]
assert countdown_start.index("drawScreen();") < countdown_start.index("countdownStartedAt = millis();"), (
    "the countdown duration must start after the preparation screen is drawn"
)

wifi_screen = source.split("void connectWiFiRoutine() {", 1)[1].split(
    "// AKSI TOMBOL DAN TRANSISI SISTEM", 1
)[0]
assert "tryConnectBestWifi()" in wifi_screen
assert "while (" not in wifi_screen and "delay(" not in wifi_screen, (
    "Wi-Fi screen handling must not block the main loop while waiting for a connection"
)

wifi_retry = source.split('if (millis() - lastWifiCheckTask > 1000)', 1)[1].split('} else if', 1)[0]
assert "tryConnectBestWifi();" in wifi_retry, "expired Wi-Fi attempts must retry through the profile selector"
assert "wifiConnectInProgress = false;" not in wifi_retry, (
    "the Wi-Fi retry caller must preserve expired state so profile failover can run"
)

tracked_headers = (
    repo / "esp32/ELOTO_FIXED/device_secrets.h",
    repo / "esp32/ELOTO_FIXED/device_secrets.local.h",
    repo / "esp32/ELOTO_FIXED/network_secrets.h",
)
secret_macros = {"ELOTO_DEVICE_ID", "ELOTO_NETWORK_SSID", "ELOTO_NETWORK_PASSWORD"}
for header in tracked_headers:
    for line in header.read_text(encoding="utf-8").splitlines():
        match = re.match(r"\s*#\s*define\s+([A-Za-z0-9_]+)\s+(.+?)\s*$", line)
        if not match or match.group(1) not in secret_macros:
            continue
        value = match.group(2).strip().strip('"\'').lower()
        assert not value or any(marker in value for marker in ("replace-with", "your-", "placeholder", "isi_")), (
            f"configured secret must live in an ignored local file: {header.name}"
        )

ignore_file = (repo / ".gitignore").read_text(encoding="utf-8")
for ignored in ("device_secrets.override.h", "network_secrets.local.h"):
    assert ignored in ignore_file, f"local secret override is not ignored: {ignored}"

print("Firmware source security checks passed: explicit endpoint, CA-validated TLS, and scoped transport.")
