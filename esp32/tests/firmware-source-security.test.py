#!/usr/bin/env python3
from pathlib import Path
import re


firmware = Path(__file__).parents[1] / "ELOTO_FIXED" / "ELOTO_FIXED.ino"
source = firmware.read_text(encoding="utf-8-sig")
repo = Path(__file__).parents[2]

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
    'request.addHeader("X-Device-IP", WiFi.localIP().toString());',
    "WiFi.setAutoReconnect(true);",
    "secureClient.lastError(error, sizeof(error))",
    "BACKEND_DISCOVERY_RETRY_MS",
)
for marker in required:
    assert marker in source, f"required active firmware mitigation missing: {marker}"

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

assert source.count("ServerHttpClient http;") == 6

wifi_retry = source.split('if (millis() - lastWifiCheckTask > 10000)', 1)[1].split('} else if', 1)[0]
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
for ignored in ("device_secrets.profile.h", "device_secrets.override.h", "network_secrets.local.h"):
    assert ignored in ignore_file, f"local secret override is not ignored: {ignored}"

print("Firmware source security checks passed: explicit endpoint, CA-validated TLS, and scoped transport.")
