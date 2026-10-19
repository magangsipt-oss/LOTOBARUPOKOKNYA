#pragma once

#include <cstddef>
#include <cstdint>
#include <cstring>

namespace eloto {

struct DerElement {
    uint8_t tag;
    const uint8_t *data;
    size_t size;
};

inline bool readDer(const uint8_t *&cursor, const uint8_t *end, DerElement &element) {
    if (cursor >= end) return false;
    element.tag = *cursor++;
    if (cursor >= end || (element.tag & 0x1f) == 0x1f) return false;

    size_t length = *cursor++;
    if (length & 0x80) {
        size_t count = length & 0x7f;
        if (count == 0 || count > sizeof(size_t) || size_t(end - cursor) < count || *cursor == 0) return false;
        length = 0;
        while (count--) {
            if (length > (SIZE_MAX >> 8)) return false;
            length = (length << 8) | *cursor++;
        }
        if (length < 128) return false;
    }

    if (length > size_t(end - cursor)) return false;
    element.data = cursor;
    element.size = length;
    cursor += length;
    return true;
}

inline bool certificateHasIpv4San(const uint8_t *der, size_t size, const uint8_t expected[4]) {
    if (!der || !size) return false;

    const uint8_t *cursor = der;
    const uint8_t *end = der + size;
    DerElement certificate, tbs, field;
    if (!readDer(cursor, end, certificate) || certificate.tag != 0x30 || cursor != end) return false;
    cursor = certificate.data;
    end = cursor + certificate.size;
    if (!readDer(cursor, end, tbs) || tbs.tag != 0x30) return false;

    cursor = tbs.data;
    end = cursor + tbs.size;
    while (cursor < end) {
        if (!readDer(cursor, end, field)) return false;
        if (field.tag != 0xa3) continue;

        const uint8_t *extensions = field.data;
        const uint8_t *extensionsEnd = extensions + field.size;
        DerElement sequence;
        if (!readDer(extensions, extensionsEnd, sequence) ||
            sequence.tag != 0x30 || extensions != extensionsEnd) return false;

        extensions = sequence.data;
        extensionsEnd = extensions + sequence.size;
        while (extensions < extensionsEnd) {
            DerElement extension, oid, value;
            if (!readDer(extensions, extensionsEnd, extension) || extension.tag != 0x30) return false;
            const uint8_t *item = extension.data;
            const uint8_t *itemEnd = item + extension.size;
            if (!readDer(item, itemEnd, oid) || oid.tag != 0x06) return false;

            const uint8_t sanOid[] = {0x55, 0x1d, 0x11};
            if (oid.size != sizeof(sanOid) || std::memcmp(oid.data, sanOid, sizeof(sanOid))) continue;
            if (!readDer(item, itemEnd, value)) return false;
            if (value.tag == 0x01 && !readDer(item, itemEnd, value)) return false;
            if (value.tag != 0x04 || item != itemEnd) return false;

            item = value.data;
            itemEnd = item + value.size;
            if (!readDer(item, itemEnd, sequence) || sequence.tag != 0x30 || item != itemEnd) return false;
            item = sequence.data;
            itemEnd = item + sequence.size;

            bool matches = false;
            while (item < itemEnd) {
                if (!readDer(item, itemEnd, value)) return false;
                if (value.tag == 0x87 && value.size == 4 &&
                    !std::memcmp(value.data, expected, 4)) matches = true;
            }
            return matches;
        }
        return false;
    }
    return false;
}

}
