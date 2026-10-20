#include "../PhotoCacheIO.h"

#include <algorithm>
#include <cassert>
#include <cstdlib>
#include <iostream>
#include <string>
#include <vector>

using eloto::photo::WriteResult;
using eloto::photo::writeVerifiedJpeg;

static std::vector<uint8_t> jpeg(size_t size) {
    std::vector<uint8_t> data(size);
    for (size_t i = 0; i < size; ++i) data[i] = static_cast<uint8_t>(i * 37);
    data[0] = 0xFF;
    data[1] = 0xD8;
    data[size - 2] = 0xFF;
    data[size - 1] = 0xD9;
    return data;
}

// A separate operation adapter exercises errors hidden by Arduino File.flush()/close().
struct FaultOps {
    std::vector<uint8_t> stored;
    size_t readAt = 0;
    size_t writeLimit = 512;
    size_t readLimit = 512;
    size_t writeFailAfter = static_cast<size_t>(-1);
    size_t readFailAfter = static_cast<size_t>(-1);
    int writeInterrupts = 0;
    int readInterrupts = 0;
    int syncInterrupts = 0;
    int openInterrupts = 0;
    int closeCalls = 0;
    int openCalls = 0;
    int active = -1;
    bool zeroWrite = false;
    bool failOpenWrite = false;
    bool failOpenRead = false;
    bool failSync = false;
    bool failCloseWrite = false;
    bool failCloseRead = false;
    bool truncateOnRead = false;
    bool emptyOnRead = false;
    bool corruptOnRead = false;
    bool appendOnRead = false;

    int open(const char *, int flags, mode_t mode) {
        ++openCalls;
        assert(active == -1);
        if (openInterrupts > 0) { --openInterrupts; errno = EINTR; return -1; }
        if (flags & O_WRONLY) {
            assert(flags == (O_WRONLY | O_CREAT | O_TRUNC) && mode == 0600);
            if (failOpenWrite) { errno = EACCES; return -1; }
            stored.clear();
            active = 17;
        } else {
            assert(flags == O_RDONLY);
            if (failOpenRead) { errno = EACCES; return -1; }
            if (truncateOnRead) stored.pop_back();
            if (emptyOnRead) stored.clear();
            if (corruptOnRead) stored[5] ^= 1;
            if (appendOnRead) stored.push_back(0);
            readAt = 0;
            active = 18;
        }
        return active;
    }
    ssize_t write(int fd, const uint8_t *data, size_t count) {
        assert(fd == active && fd == 17 && count <= 512);
        if (writeInterrupts > 0) { --writeInterrupts; errno = EINTR; return -1; }
        if (zeroWrite) return 0;
        if (stored.size() >= writeFailAfter) { errno = ENOSPC; return -1; }
        count = std::min(count, std::min(writeLimit, writeFailAfter - stored.size()));
        stored.insert(stored.end(), data, data + count);
        return static_cast<ssize_t>(count);
    }
    ssize_t read(int fd, uint8_t *data, size_t count) {
        assert(fd == active && fd == 18 && count <= 512);
        if (readInterrupts > 0) { --readInterrupts; errno = EINTR; return -1; }
        if (readAt >= readFailAfter) { errno = EIO; return -1; }
        count = std::min(count, std::min(readLimit, stored.size() - readAt));
        count = std::min(count, readFailAfter - readAt);
        if (count) memcpy(data, stored.data() + readAt, count);
        readAt += count;
        return static_cast<ssize_t>(count);
    }
    int sync(int fd) {
        assert(fd == active && fd == 17);
        if (syncInterrupts > 0) { --syncInterrupts; errno = EINTR; return -1; }
        if (failSync) { errno = EIO; return -1; }
        return 0;
    }
    int close(int fd) {
        assert(fd == active && (fd == 17 || fd == 18));
        active = -1;
        ++closeCalls;
        if ((fd == 17 && failCloseWrite) || (fd == 18 && failCloseRead)) {
            errno = EINTR;
            return -1;
        }
        return 0;
    }
};

static void fails(FaultOps &ops, const std::vector<uint8_t> &data,
                  const char *stage, int error) {
    WriteResult result;
    assert(!writeVerifiedJpeg("/test.TMP", data.data(), data.size(), result, ops));
    assert(std::string(result.stage) == stage);
    assert(result.error == error && errno == error);
    assert(ops.active == -1);
}

int main() {
    // Both observed payload sizes round-trip through the real unbuffered POSIX API.
    char directory[] = "/tmp/eloto-photo-io-XXXXXX";
    assert(mkdtemp(directory));
    const std::string path = std::string(directory) + "/photo.TMP";
    for (size_t size : {size_t(2537), size_t(2445)}) {
        const auto data = jpeg(size);
        WriteResult result;
        assert(writeVerifiedJpeg(path.c_str(), data.data(), size, result));
        assert(result.error == 0 && std::string(result.stage) == "done");
        assert(result.written == size && result.verified == size);
        int fd = ::open(path.c_str(), O_RDONLY);
        assert(fd >= 0);
        std::vector<uint8_t> actual(size + 1);
        assert(::read(fd, actual.data(), actual.size()) == static_cast<ssize_t>(size));
        assert(std::equal(data.begin(), data.end(), actual.begin()));
        assert(::close(fd) == 0);
    }
    assert(::unlink(path.c_str()) == 0);
    assert(::rmdir(directory) == 0);

    const auto data = jpeg(2445);
    {
        FaultOps ops;
        ops.writeLimit = 37;
        ops.readLimit = 29;
        ops.writeInterrupts = 2;
        ops.readInterrupts = 2;
        ops.syncInterrupts = 1;
        ops.openInterrupts = 1;
        WriteResult result;
        assert(writeVerifiedJpeg("/test.TMP", data.data(), data.size(), result, ops));
        assert(result.written == data.size() && result.verified == data.size());
        assert(ops.stored == data && ops.active == -1 && ops.closeCalls == 2);
    }
    for (size_t size : {size_t(101), size_t(60000)}) {
        const auto boundary = jpeg(size);
        FaultOps ops;
        WriteResult result;
        assert(writeVerifiedJpeg("/test.TMP", boundary.data(), boundary.size(), result, ops));
        assert(result.written == size && result.verified == size);
    }
    for (int marker : {0, 1, 2443, 2444}) {
        auto invalid = data;
        invalid[marker] = 0;
        FaultOps ops;
        fails(ops, invalid, "validate", EINVAL);
        assert(ops.openCalls == 0);
    }
    for (size_t size : {size_t(100), size_t(60001)}) {
        FaultOps ops;
        fails(ops, jpeg(size), "validate", EINVAL);
        assert(ops.openCalls == 0);
    }
    {
        FaultOps ops;
        WriteResult result;
        assert(!writeVerifiedJpeg(nullptr, data.data(), data.size(), result, ops));
        assert(result.error == EINVAL && ops.openCalls == 0);
        assert(!writeVerifiedJpeg("/test.TMP", nullptr, data.size(), result, ops));
        assert(result.error == EINVAL && ops.openCalls == 0);
    }
    {
        FaultOps ops;
        ops.failOpenWrite = true;
        fails(ops, data, "open_write", EACCES);
        assert(ops.closeCalls == 0);
    }
    {
        FaultOps ops;
        ops.writeFailAfter = 600;
        ops.failCloseWrite = true; // Cleanup's EINTR must not replace the ENOSPC error.
        WriteResult result;
        assert(!writeVerifiedJpeg("/test.TMP", data.data(), data.size(), result, ops));
        assert(result.written == 600 && result.verified == 0);
        assert(std::string(result.stage) == "write");
        assert(result.error == ENOSPC && errno == ENOSPC && ops.closeCalls == 1);
        assert(ops.active == -1);
    }
    {
        FaultOps ops;
        ops.zeroWrite = true;
        fails(ops, data, "write", EIO);
        assert(ops.closeCalls == 1);
    }
    {
        FaultOps ops;
        ops.failSync = true;
        fails(ops, data, "sync", EIO);
        assert(ops.closeCalls == 1);
    }
    {
        FaultOps ops;
        ops.failCloseWrite = true;
        fails(ops, data, "close_write", EINTR);
        assert(ops.closeCalls == 1); // Never close the same descriptor twice after EINTR.
    }
    {
        FaultOps ops;
        ops.failOpenRead = true;
        fails(ops, data, "open_verify", EACCES);
        assert(ops.closeCalls == 1);
    }
    {
        FaultOps ops;
        ops.emptyOnRead = true;
        fails(ops, data, "verify_length", EIO);
        assert(ops.closeCalls == 2);
    }
    {
        FaultOps ops;
        ops.truncateOnRead = true;
        fails(ops, data, "verify_length", EIO);
        assert(ops.closeCalls == 2);
    }
    {
        FaultOps ops;
        ops.corruptOnRead = true;
        fails(ops, data, "verify_content", EIO);
    }
    {
        FaultOps ops;
        ops.appendOnRead = true;
        fails(ops, data, "verify_length", EIO);
    }
    {
        FaultOps ops;
        ops.readFailAfter = 512;
        fails(ops, data, "read_verify", EIO);
    }
    {
        FaultOps ops;
        ops.failCloseRead = true;
        fails(ops, data, "close_verify", EINTR);
        assert(ops.closeCalls == 2);
    }
    std::cout << "Photo cache I/O tests passed\n";
}
