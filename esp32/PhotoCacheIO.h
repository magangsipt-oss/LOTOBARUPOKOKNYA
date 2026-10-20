#pragma once

#include <errno.h>
#include <fcntl.h>
#include <stddef.h>
#include <stdint.h>
#include <string.h>
#include <sys/types.h>
#include <unistd.h>

namespace eloto {
namespace photo {

struct WriteResult {
    const char *stage = "validate";
    int error = 0;
    size_t written = 0;
    size_t verified = 0;
};

struct PosixOps {
    int open(const char *path, int flags, mode_t mode) { return ::open(path, flags, mode); }
    ssize_t write(int fd, const uint8_t *data, size_t size) { return ::write(fd, data, size); }
    ssize_t read(int fd, uint8_t *data, size_t size) { return ::read(fd, data, size); }
    int sync(int fd) { return ::fsync(fd); }
    int close(int fd) { return ::close(fd); }
};

namespace detail {
template<typename Ops>
inline bool fail(Ops &ops, int &fd, WriteResult &result, const char *stage, int error) {
    result.stage = stage;
    result.error = error ? error : EIO;
    if (fd >= 0) {
        // Do not retry close: after EINTR the descriptor may already have been released.
        ops.close(fd);
        fd = -1;
    }
    errno = result.error;
    return false;
}
}  // namespace detail

// The caller owns SD/SPI locking, temporary-file cleanup, and the final atomic rename.
// Use the mounted POSIX path (for example /sd/foto/CTZTO.TMP), not an SD-relative path.
template<typename Ops>
inline bool writeVerifiedJpeg(const char *path, const uint8_t *data, size_t size,
                              WriteResult &result, Ops &ops) {
    result = WriteResult();
    int fd = -1;
    if (!path || !path[0] || !data || size <= 100 || size > 60000 ||
        data[0] != 0xFF || data[1] != 0xD8 ||
        data[size - 2] != 0xFF || data[size - 1] != 0xD9) {
        return detail::fail(ops, fd, result, "validate", EINVAL);
    }

    do {
        fd = ops.open(path, O_WRONLY | O_CREAT | O_TRUNC, 0600);
    } while (fd < 0 && errno == EINTR);
    if (fd < 0) return detail::fail(ops, fd, result, "open_write", errno);

    while (result.written < size) {
        size_t count = size - result.written;
        if (count > 512) count = 512;
        ssize_t written = ops.write(fd, data + result.written, count);
        if (written < 0) {
            if (errno == EINTR) continue;
            return detail::fail(ops, fd, result, "write", errno);
        }
        if (written == 0 || static_cast<size_t>(written) > count) {
            return detail::fail(ops, fd, result, "write", EIO);
        }
        result.written += static_cast<size_t>(written);
    }

    int synced;
    do {
        synced = ops.sync(fd);
    } while (synced < 0 && errno == EINTR);
    if (synced < 0) return detail::fail(ops, fd, result, "sync", errno);

    int closed = ops.close(fd);
    fd = -1;
    if (closed < 0) return detail::fail(ops, fd, result, "close_write", errno);

    do {
        fd = ops.open(path, O_RDONLY, 0);
    } while (fd < 0 && errno == EINTR);
    if (fd < 0) return detail::fail(ops, fd, result, "open_verify", errno);

    uint8_t chunk[512];
    while (result.verified < size) {
        size_t count = size - result.verified;
        if (count > sizeof(chunk)) count = sizeof(chunk);
        ssize_t received = ops.read(fd, chunk, count);
        if (received < 0) {
            if (errno == EINTR) continue;
            return detail::fail(ops, fd, result, "read_verify", errno);
        }
        if (received == 0 || static_cast<size_t>(received) > count) {
            return detail::fail(ops, fd, result, "verify_length", EIO);
        }
        if (memcmp(chunk, data + result.verified, static_cast<size_t>(received)) != 0) {
            return detail::fail(ops, fd, result, "verify_content", EIO);
        }
        result.verified += static_cast<size_t>(received);
    }

    ssize_t extra;
    do {
        extra = ops.read(fd, chunk, 1);
    } while (extra < 0 && errno == EINTR);
    if (extra < 0) return detail::fail(ops, fd, result, "read_verify", errno);
    if (extra != 0) return detail::fail(ops, fd, result, "verify_length", EIO);

    closed = ops.close(fd);
    fd = -1;
    if (closed < 0) return detail::fail(ops, fd, result, "close_verify", errno);
    result.stage = "done";
    return true;
}

inline bool writeVerifiedJpeg(const char *path, const uint8_t *data, size_t size,
                              WriteResult &result) {
    PosixOps ops;
    return writeVerifiedJpeg(path, data, size, result, ops);
}

}  // namespace photo
}  // namespace eloto
