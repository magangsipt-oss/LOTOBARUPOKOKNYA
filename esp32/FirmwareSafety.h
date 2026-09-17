#pragma once

#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <string>
#include <vector>

namespace eloto {

inline bool validEventId(const std::string &id) {
    if (id.empty() || id.size() > 100) return false;
    for (char c : id) {
        if (!((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') ||
              (c >= '0' && c <= '9') || c == '_' || c == '-')) return false;
    }
    return true;
}

inline std::string newEventId(uint32_t a, uint32_t b, uint32_t c, uint32_t d) {
    char result[40];
    std::snprintf(result, sizeof(result), "evt-%08lx%08lx%08lx%08lx",
                  static_cast<unsigned long>(a), static_cast<unsigned long>(b),
                  static_cast<unsigned long>(c), static_cast<unsigned long>(d));
    return result;
}

inline std::string legacyEventId(const std::string &line, uint32_t offset) {
    uint64_t hash = UINT64_C(14695981039346656037);
    for (unsigned char c : line) { hash ^= c; hash *= UINT64_C(1099511628211); }
    char result[40];
    std::snprintf(result, sizeof(result), "legacy-%016llx-%08lx",
                  static_cast<unsigned long long>(hash), static_cast<unsigned long>(offset));
    return result;
}

struct OfflineRecord {
    std::string eventId, event, uid;
    bool gpsFix = false;
    double latitude = 0, longitude = 0;
};

inline bool parseCoordinate(const std::string &value, double limit, double &result) {
    if (value.empty()) return false;
    char *end = nullptr;
    result = std::strtod(value.c_str(), &end);
    return end == value.c_str() + value.size() && std::isfinite(result) && std::fabs(result) <= limit;
}

// Keep legacy IDs stable for the lifetime of an immutable upload batch.
inline bool parseOfflineRecord(const std::string &line, uint32_t offset, OfflineRecord &record) {
    if (line.empty() || line.size() > 512 || line.find_first_of("\r\n") != std::string::npos) return false;
    std::vector<std::string> fields;
    size_t start = 0;
    do {
        size_t comma = line.find(',', start);
        fields.push_back(line.substr(start, comma == std::string::npos ? comma : comma - start));
        if (fields.size() > 6) return false;
        if (comma == std::string::npos) break;
        start = comma + 1;
    } while (true);
    if (fields.size() != 3 && fields.size() != 5 && fields.size() != 6) return false;
    if (fields[0].empty() || fields[0].find_first_not_of("0123456789") != std::string::npos ||
        fields[1].empty() || fields[1].size() > 100 || fields[2].size() > 50) return false;
    OfflineRecord parsed;
    parsed.event = fields[1];
    parsed.uid = fields[2];
    parsed.eventId = fields.size() == 6 ? fields[5] : legacyEventId(line, offset);
    if (!validEventId(parsed.eventId)) return false;
    if (fields.size() >= 5 && (!fields[3].empty() || !fields[4].empty())) {
        if (!parseCoordinate(fields[3], 90, parsed.latitude) ||
            !parseCoordinate(fields[4], 180, parsed.longitude)) return false;
        parsed.gpsFix = true;
    }
    record = parsed;
    return true;
}

inline bool validSessionBounds(int state, int firstState, int lastState, int top,
                               size_t count, int target, size_t capacity) {
    return state >= firstState && state <= lastState && top >= -1 &&
           top < static_cast<int>(capacity) && count <= capacity &&
           count == static_cast<size_t>(top + 1) && target >= 0 &&
           target < static_cast<int>(capacity);
}

// Only explicitly configured HTTP authorities are supported until a CA is provisioned.
// Reject HTTPS here instead of silently downgrading it or using an insecure TLS client.
inline bool supportedHttpHost(std::string host) {
    if (host.compare(0, 7, "http://") == 0) host.erase(0, 7);
    if (host.empty()) return false;
    size_t colon = host.find(':');
    std::string name = host.substr(0, colon);
    if (name.empty()) return false;
    for (char c : name) {
        if (!((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') ||
              (c >= '0' && c <= '9') || c == '-' || c == '.')) return false;
    }
    if (colon != std::string::npos) {
        std::string port = host.substr(colon + 1);
        if (port.empty() || port.size() > 5 || port.find_first_not_of("0123456789") != std::string::npos) return false;
        long number = std::strtol(port.c_str(), nullptr, 10);
        if (number < 1 || number > 65535) return false;
    }
    return true;
}

inline std::string encodePathComponent(const std::string &value) {
    const char *hex = "0123456789ABCDEF";
    std::string result;
    for (unsigned char c : value) {
        if ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') ||
            (c >= '0' && c <= '9') || c == '-' || c == '_' || c == '.' || c == '~') {
            result += static_cast<char>(c);
        } else {
            result += '%'; result += hex[c >> 4]; result += hex[c & 15];
        }
    }
    return result;
}

} // namespace eloto
