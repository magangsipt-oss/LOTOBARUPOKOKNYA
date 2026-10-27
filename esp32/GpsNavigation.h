#pragma once

#include <cmath>
#include <cstdlib>
#include <string>

namespace eloto {

// SIMCom SIM800 Series GNSS Application Note V1.00, table 2-3.
// Indexes below are zero based; empty CSV fields must retain their position.
struct GpsNavigationReading {
    bool running = false;
    bool fix = false;
    double latitude = 0;
    double longitude = 0;
    float hdop = 99.9f;
    bool hdopValid = false;
    unsigned satellitesVisible = 0;
    unsigned satellitesUsed = 0;
    bool satellitesVisibleValid = false;
    bool satellitesUsedValid = false;
    unsigned cn0Max = 0;
    bool cn0Valid = false;
    std::string utc;
};

inline std::string trimGpsField(const std::string &value) {
    const size_t first = value.find_first_not_of(" \t\r");
    if (first == std::string::npos) return "";
    return value.substr(first, value.find_last_not_of(" \t\r") - first + 1);
}

inline bool parseGpsNumber(const std::string &field, double minimum,
        double maximum, double &value) {
    if (field.empty()) return false;
    char *end = nullptr;
    const double parsed = std::strtod(field.c_str(), &end);
    if (end == field.c_str() || *end != '\0' || !std::isfinite(parsed) ||
            parsed < minimum || parsed > maximum) return false;
    value = parsed;
    return true;
}

inline bool validGpsUtc(const std::string &utc) {
    if (utc.size() != 14 && (utc.size() < 16 || utc.size() > 18 || utc[14] != '.'))
        return false;
    for (size_t i = 0; i < utc.size(); ++i) {
        if (i == 14) continue;
        if (utc[i] < '0' || utc[i] > '9') return false;
    }
    const int month = std::atoi(utc.substr(4, 2).c_str());
    const int day = std::atoi(utc.substr(6, 2).c_str());
    return month >= 1 && month <= 12 && day >= 1 && day <= 31 &&
        std::atoi(utc.substr(8, 2).c_str()) <= 23 &&
        std::atoi(utc.substr(10, 2).c_str()) <= 59 &&
        std::atoi(utc.substr(12, 2).c_str()) <= 60;
}

inline bool parseGpsNavigation(const char *response, GpsNavigationReading &reading) {
    const std::string input(response ? response : "");
    const size_t prefix = input.find("+CGNSINF:");
    if (prefix == std::string::npos) return false;
    const size_t begin = prefix + 9;
    const size_t newline = input.find('\n', begin);
    if (newline == std::string::npos || newline - begin > 384) return false;

    std::string fields[21];
    size_t count = 0, start = begin;
    for (size_t i = begin; i <= newline; ++i) {
        if (i == newline || input[i] == ',') {
            if (count >= 21) return false;
            fields[count++] = trimGpsField(input.substr(start, i - start));
            start = i + 1;
        }
    }
    if (count < 6 || (fields[0] != "0" && fields[0] != "1") ||
            (fields[1] != "0" && fields[1] != "1" &&
             !(fields[0] == "0" && fields[1].empty()))) return false;

    GpsNavigationReading parsed;
    parsed.running = fields[0] == "1";
    parsed.utc = fields[2];
    double number = 0;
    if (parseGpsNumber(fields[10], 0, 99.9, number)) {
        parsed.hdop = number;
        parsed.hdopValid = true;
    }
    if (parseGpsNumber(fields[14], 0, 99, number) && std::floor(number) == number) {
        parsed.satellitesVisible = static_cast<unsigned>(number);
        parsed.satellitesVisibleValid = true;
    }
    if (parseGpsNumber(fields[15], 0, 99, number) && std::floor(number) == number) {
        parsed.satellitesUsed = static_cast<unsigned>(number);
        parsed.satellitesUsedValid = true;
    }
    if (parseGpsNumber(fields[18], 0, 55, number) && std::floor(number) == number) {
        parsed.cn0Max = static_cast<unsigned>(number);
        parsed.cn0Valid = true;
    }
    parsed.fix = parsed.running && fields[1] == "1" && validGpsUtc(parsed.utc) &&
        parseGpsNumber(fields[3], -90, 90, parsed.latitude) &&
        parseGpsNumber(fields[4], -180, 180, parsed.longitude) &&
        (parsed.latitude != 0 || parsed.longitude != 0);
    reading = parsed; // Missing quality fields never inherit a previous fix's quality.
    return true;
}

} // namespace eloto
