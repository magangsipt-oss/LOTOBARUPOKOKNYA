#!/usr/bin/env python3
"""Compile the firmware's real deferred photo-cache service against controlled I/O."""

from pathlib import Path
import re
import subprocess
import tempfile


source = (Path(__file__).resolve().parents[1] / "ELOTO_FIXED/ELOTO_FIXED.ino").read_text()
match = re.search(r"void servicePhotoDisplayCache\(\)\s*\{", source)
assert match, "Expected the no-argument servicePhotoDisplayCache implementation"
end, depth = match.end(), 1
while depth:
    depth += (source[end] == "{") - (source[end] == "}")
    end += 1
function = source[match.start():end]
constants = "\n".join(
    re.search(r"const uint(?:8|32)_t " + name + r"\s*=\s*\d+;", source).group()
    for name in ("PHOTO_SYNC_RETRY_MS", "PHOTO_PREFETCH_MAX_RETRIES")
)

harness = r'''
#include <cassert>
#include <cctype>
#include <cstddef>
#include <cstdint>
#include <iostream>
#include <string>
struct String {
    std::string value;
    String(const char *text = "") : value(text) {}
    bool equalsIgnoreCase(const String &other) const {
        if (value.size() != other.value.size()) return false;
        for (size_t i = 0; i < value.size(); ++i)
            if (std::tolower(static_cast<unsigned char>(value[i])) !=
                std::tolower(static_cast<unsigned char>(other.value[i]))) return false;
        return true;
    }
};
const int pdTRUE = 1;
const uint32_t portMAX_DELAY = UINT32_MAX;
uint32_t pdMS_TO_TICKS(uint32_t value) { return value; }
int photoSyncMutex = 1;
bool mutexHeld = false;
int xSemaphoreTake(int mutex, uint32_t) {
    assert(mutex == photoSyncMutex && !mutexHeld);
    mutexHeld = true;
    return pdTRUE;
}
void xSemaphoreGive(int mutex) { assert(mutex == photoSyncMutex && mutexHeld); mutexHeld = false; }
uint32_t now = 1000;
uint32_t millis() { return now; }
bool sdCardMounted = true, relayPulseActive = false;
uint8_t payload[2445] = {42};
uint8_t *photoDisplayData = payload;
size_t photoDisplaySize = sizeof(payload);
String photoDisplayUid = "3C00035095", photoDisplaySid = "CTZTO";
String photoDisplayRequestedUid = "3c00035095";
bool photoDisplayOnSd = false, photoDisplayRendered = false, photoDisplayCachePending = true;
uint8_t photoDisplayCacheAttempts = 0;
uint32_t photoDisplayReadyAt = 1000, photoDisplayCacheAttemptAt = 0;
int writes = 0;
bool saveSucceeds = true;
bool cachePhotoBufferToSD(const String &uid, const String &sid, const uint8_t *data, size_t size) {
    assert(!mutexHeld && data == payload && data == photoDisplayData && size == sizeof(payload));
    assert(uid.equalsIgnoreCase("3C00035095") && sid.equalsIgnoreCase("CTZTO"));
    // A display consumer can acquire the mutex and use the buffer during persistence.
    assert(xSemaphoreTake(photoSyncMutex, 0) == pdTRUE);
    assert(!photoDisplayOnSd && photoDisplayCachePending && data[0] == 42);
    xSemaphoreGive(photoSyncMutex);
    ++writes;
    return saveSucceeds;
}
void reset() {
    assert(!mutexHeld);
    now = photoDisplayReadyAt = 1000;
    photoDisplayCacheAttemptAt = 0;
    photoDisplayCacheAttempts = 0;
    photoDisplayData = payload;
    photoDisplayOnSd = photoDisplayRendered = false;
    photoDisplayCachePending = saveSucceeds = true;
    photoDisplayRequestedUid = "3c00035095";
    writes = 0;
}
'''

checks = r'''
int main() {
    reset();
    now += PHOTO_SYNC_RETRY_MS - 1;
    servicePhotoDisplayCache();
    assert(writes == 0 && photoDisplayCacheAttempts == 0 && !mutexHeld);

    reset();
    photoDisplayRendered = true;
    servicePhotoDisplayCache();
    assert(writes == 1 && photoDisplayOnSd && !photoDisplayCachePending && !mutexHeld);
    assert(photoDisplayData == payload);
    servicePhotoDisplayCache();
    assert(writes == 1);

    reset();
    photoDisplayRendered = true;
    saveSucceeds = false;
    for (uint8_t attempt = 0; attempt < PHOTO_PREFETCH_MAX_RETRIES; ++attempt) {
        now = 1000 + attempt * PHOTO_SYNC_RETRY_MS;
        servicePhotoDisplayCache();
        assert(writes == attempt + 1 && photoDisplayCacheAttempts == attempt + 1);
        assert(!photoDisplayOnSd && photoDisplayCachePending && photoDisplayData == payload);
        now += PHOTO_SYNC_RETRY_MS - 1;
        servicePhotoDisplayCache();
        assert(writes == attempt + 1);
    }
    now += PHOTO_SYNC_RETRY_MS;
    servicePhotoDisplayCache();
    assert(writes == PHOTO_PREFETCH_MAX_RETRIES && !mutexHeld);

    reset();
    photoDisplayRequestedUid = "OTHER";
    servicePhotoDisplayCache();
    assert(writes == 1 && photoDisplayOnSd);

    reset();
    now += PHOTO_SYNC_RETRY_MS;
    servicePhotoDisplayCache();
    assert(writes == 1 && photoDisplayOnSd && !photoDisplayRendered);
    std::cout << "Photo display cache tests passed\n";
}
'''

with tempfile.TemporaryDirectory(prefix="eloto-photo-display-") as directory:
    cpp = Path(directory) / "test.cpp"
    binary = Path(directory) / "test"
    cpp.write_text(harness + constants + "\n" + function + "\n" + checks)
    subprocess.run([
        "g++", "-std=c++11", "-Wall", "-Wextra", "-Werror", "-pedantic",
        str(cpp), "-o", str(binary),
    ], check=True)
    subprocess.run([str(binary)], check=True)
