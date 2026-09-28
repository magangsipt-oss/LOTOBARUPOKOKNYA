#pragma once

#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <string>
#include <vector>

namespace eloto {

inline std::string normalizeConfigLine(const std::string &input) {
    std::string result;
    result.reserve(input.size());
    for (size_t i = 0; i < input.size(); ++i) {
        const unsigned char c = static_cast<unsigned char>(input[i]);
        if (c == 0 || c == '\r' || c == '\n') continue;
        if (i + 2 < input.size() && c == 0xef &&
            static_cast<unsigned char>(input[i + 1]) == 0xbb &&
            static_cast<unsigned char>(input[i + 2]) == 0xbf) {
            i += 2;
            continue;
        }
        if (i + 1 < input.size() &&
            ((c == 0xff && static_cast<unsigned char>(input[i + 1]) == 0xfe) ||
             (c == 0xfe && static_cast<unsigned char>(input[i + 1]) == 0xff))) {
            ++i;
            continue;
        }
        result += static_cast<char>(c);
    }
    return result;
}

inline bool validEventId(const std::string &id) {
    if (id.empty() || id.size() > 100) return false;
    for (char c : id) {
        if (!((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') ||
              (c >= '0' && c <= '9') || c == '_' || c == '-')) return false;
    }
    return true;
}

inline bool validDeviceToken(const std::string &token) {
    if (token.size() < 32 || token.size() > 256 || token.compare(0, 13, "replace-with-") == 0) return false;
    for (unsigned char c : token) {
        if (c < 0x21 || c > 0x7e) return false;
    }
    return true;
}

inline bool validDeviceId(const std::string &id) {
    if (id.empty() || id.size() > 100 || id.front() == ' ' || id.back() == ' ') return false;
    for (unsigned char c : id) {
        if (c < 0x20 || c > 0x7e) return false;
    }
    return true;
}

inline bool validWifiSsid(const std::string &ssid) {
    if (ssid.empty() || ssid.size() > 32) return false;
    for (unsigned char c : ssid) {
        if (c < 0x20 || c > 0x7e) return false;
    }
    return true;
}

inline bool validWifiPassword(const std::string &password) {
    if (password.size() < 8 || password.size() > 63) return false;
    for (unsigned char c : password) {
        if (c < 0x20 || c > 0x7e) return false;
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
    const bool legacyTimestamp = !fields[0].empty() &&
        fields[0].find_first_not_of("0123456789") == std::string::npos;
    if (fields[0].empty() || fields[1].empty() || fields[1].size() > 100 || fields[2].size() > 50) return false;
    OfflineRecord parsed;
    parsed.event = fields[1];
    parsed.uid = fields[2];
    if (fields.size() == 6) {
        if (!legacyTimestamp) return false;
        parsed.eventId = fields[5];
    } else if (legacyTimestamp) {
        parsed.eventId = legacyEventId(line, offset);
    } else {
        parsed.eventId = fields[0];
    }
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

// Accept HTTPS endpoints and explicit private-LAN HTTP endpoints. Reject paths,
// credentials, control characters, and public cleartext hosts.
struct ServerEndpoint {
    std::string baseUrl;
    bool secure = false;
};

inline bool parseIpv4(const std::string &name, unsigned octets[4]) {
    size_t start = 0;
    for (size_t i = 0; i < 4; ++i) {
        size_t dot = name.find('.', start);
        if ((i < 3 && dot == std::string::npos) || (i == 3 && dot != std::string::npos)) return false;
        const size_t end = dot == std::string::npos ? name.size() : dot;
        const std::string part = name.substr(start, end - start);
        if (part.empty() || part.size() > 3 || part.find_first_not_of("0123456789") != std::string::npos) return false;
        const long value = std::strtol(part.c_str(), nullptr, 10);
        if (value < 0 || value > 255) return false;
        octets[i] = static_cast<unsigned>(value);
        start = end + 1;
    }
    return true;
}

inline bool validDnsName(const std::string &name) {
    if (name.empty() || name.size() > 253 || name.front() == '.' || name.back() == '.') return false;
    size_t labelStart = 0;
    for (size_t i = 0; i <= name.size(); ++i) {
        if (i != name.size() && name[i] != '.') {
            const char c = name[i];
            if (!((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') ||
                  (c >= '0' && c <= '9') || c == '-')) return false;
            continue;
        }
        const size_t labelLength = i - labelStart;
        if (labelLength == 0 || labelLength > 63 || name[labelStart] == '-' || name[i - 1] == '-') return false;
        labelStart = i + 1;
    }
    return true;
}

inline bool localHttpName(const std::string &name) {
    unsigned octets[4] = {};
    if (parseIpv4(name, octets)) {
        return octets[0] == 10 || octets[0] == 127 ||
               (octets[0] == 169 && octets[1] == 254) ||
               (octets[0] == 172 && octets[1] >= 16 && octets[1] <= 31) ||
               (octets[0] == 192 && octets[1] == 168);
    }
    if (name.find_first_not_of("0123456789.") == std::string::npos) return false;
    return name == "localhost" ||
           (name.size() > 6 && name.compare(name.size() - 6, 6, ".local") == 0);
}

inline bool parseServerEndpoint(const std::string &input, ServerEndpoint &endpoint) {
    if (input.empty() || input.size() > 300 || input.find_first_of("\r\n\t ?#@") != std::string::npos) return false;
    std::string authority = input;
    bool secure = false;
    if (authority.compare(0, 8, "https://") == 0) {
        authority.erase(0, 8);
        secure = true;
    } else if (authority.compare(0, 7, "http://") == 0) {
        authority.erase(0, 7);
    } else if (authority.find("://") != std::string::npos) {
        return false;
    }
    if (!authority.empty() && authority.back() == '/') authority.pop_back();
    if (authority.empty() || authority.find('/') != std::string::npos) return false;

    const size_t colon = authority.find(':');
    if (colon != std::string::npos && authority.find(':', colon + 1) != std::string::npos) return false;
    const std::string name = authority.substr(0, colon);
    unsigned octets[4] = {};
    if (!parseIpv4(name, octets) && !validDnsName(name)) return false;
    if (colon != std::string::npos) {
        const std::string port = authority.substr(colon + 1);
        if (port.empty() || port.size() > 5 || port.find_first_not_of("0123456789") != std::string::npos) return false;
        const long number = std::strtol(port.c_str(), nullptr, 10);
        if (number < 1 || number > 65535) return false;
    }
    if (!secure && !localHttpName(name)) return false;
    endpoint.baseUrl = std::string(secure ? "https://" : "http://") + authority + "/";
    endpoint.secure = secure;
    return true;
}

enum WifiConfigField {
    WIFI_CONFIG_NONE,
    WIFI_CONFIG_SSID,
    WIFI_CONFIG_PASSWORD
};

inline bool parseIndexedWifiKey(const std::string &key, size_t capacity, size_t &slot, WifiConfigField &field) {
    if (key.compare(0, 5, "WIFI_") != 0) return false;
    const size_t separator = key.find('_', 5);
    if (separator == std::string::npos) return false;
    const std::string number = key.substr(5, separator - 5);
    if (number.empty() || number.find_first_not_of("0123456789") != std::string::npos) return false;
    const unsigned long index = std::strtoul(number.c_str(), nullptr, 10);
    if (index < 1 || index > capacity) return false;
    const std::string suffix = key.substr(separator + 1);
    if (suffix == "SSID") field = WIFI_CONFIG_SSID;
    else if (suffix == "PASS") field = WIFI_CONFIG_PASSWORD;
    else return false;
    slot = static_cast<size_t>(index - 1);
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
