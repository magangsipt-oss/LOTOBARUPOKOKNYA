#include "../FirmwareSafety.h"
#include <cassert>
#include <climits>
#include <iostream>

int main() {
    const std::string id = eloto::newEventId(0, 1, 0x12345678, UINT32_MAX);
    assert(id == "evt-000000000000000112345678ffffffff");
    assert(eloto::validEventId(id));
    assert(!eloto::validEventId(""));
    assert(!eloto::validEventId("event/id"));
    assert(!eloto::validEventId(std::string(101, 'a')));
    assert(eloto::validEventId(std::string(100, 'a')));

    eloto::OfflineRecord original, retried, rebooted;
    const std::string line = "123,MECHANIC_LOG_IN,AABB,-5.123456,119.123456," + id;
    assert(eloto::parseOfflineRecord(line, 0, original));
    assert(eloto::parseOfflineRecord(line, 0, retried));
    assert(eloto::parseOfflineRecord(line, 2048, rebooted));
    assert(original.eventId == id && retried.eventId == id && rebooted.eventId == id);
    assert(original.event == "MECHANIC_LOG_IN" && original.uid == "AABB");
    assert(original.gpsFix && std::fabs(original.latitude + 5.123456) < 0.000001);
    assert(std::fabs(original.longitude - 119.123456) < 0.000001);
    assert(eloto::parseOfflineRecord("456,HEARTBEAT_SYNC,SYSTEM,,,event-2", 0, retried));
    assert(!retried.gpsFix && retried.eventId == "event-2");
    assert(eloto::parseOfflineRecord("789,REFUEL_END,AABB,0,0,event-3", 0, retried));
    assert(retried.gpsFix && retried.latitude == 0 && retried.longitude == 0);

    // A partially ACKed legacy batch can replay after reboot without duplicating IDs.
    const std::string legacy = "123,SUPERVISOR_LOCK_IN,AABB,-5,119";
    assert(eloto::parseOfflineRecord(legacy, 17, original));
    assert(eloto::parseOfflineRecord(legacy, 17, retried));
    assert(eloto::parseOfflineRecord(legacy, 99, rebooted));
    assert(original.eventId == retried.eventId);
    assert(original.eventId != rebooted.eventId);
    assert(eloto::validEventId(original.eventId));
    assert(eloto::parseOfflineRecord("1,REFUEL_START,AABB", 0, retried));
    assert(!retried.gpsFix);
    for (const std::string bad : {
        "", "123", "123,EVENT,UID,-5", "123,EVENT,UID,,,", "123,EVENT,UID,,,bad/id",
        "123,EVENT,UID,nan,1,event", "123,EVENT,UID,1,inf,event", "123,EVENT,UID,91,1,event",
        "123,EVENT,UID,1,-181,event", "123,EVENT,UID,,119,event", "x,EVENT,UID,,,event",
        "123,,UID,,,event", "123,EVENT,UID,,,event,extra", "123,EVENT,UID,,,event\r\n"
    }) assert(!eloto::parseOfflineRecord(bad, 0, retried));
    assert(!eloto::parseOfflineRecord("123,EVENT," + std::string(51, 'x') + ",,,event", 0, retried));

    assert(eloto::validSessionBounds(3, 0, 35, -1, 0, 0, 10));
    assert(eloto::validSessionBounds(6, 0, 35, 9, 10, 9, 10));
    assert(!eloto::validSessionBounds(6, 0, 35, 10, 11, 9, 10));
    assert(!eloto::validSessionBounds(6, 0, 35, -2, 0, 0, 10));
    assert(!eloto::validSessionBounds(6, 0, 35, 4, 2, 0, 10));
    assert(!eloto::validSessionBounds(-1, 0, 35, 0, 1, 0, 10));
    assert(!eloto::validSessionBounds(36, 0, 35, 0, 1, 0, 10));
    assert(!eloto::validSessionBounds(6, 0, 35, 0, 1, 10, 10));
    assert(!eloto::validSessionBounds(6, 0, 35, INT_MAX, SIZE_MAX, 0, 10));

    for (const std::string host : {"192.168.1.2:5002", "server.local", "http://server.local:80"}) {
        assert(eloto::supportedHttpHost(host));
    }
    for (const std::string host : {"", "https://server.local", "http://", "http://user@evil.local",
        "http://server.local/path", "server.local?redirect=evil", "server.local:0", "server.local:65536",
        "server.local:5002@evil.local", "server.local\r\nX-Test:evil", "server.local#evil", "server.local:abc"}) {
        assert(!eloto::supportedHttpHost(host));
    }
    assert(eloto::encodePathComponent("BOX ELOTO 1") == "BOX%20ELOTO%201");
    assert(eloto::encodePathComponent("BOX/#?%") == "BOX%2F%23%3F%25");
    assert(eloto::encodePathComponent("valid-ID_1.~") == "valid-ID_1.~");
    std::cout << "Firmware host checks passed: replay identity/parsing, bounds, configured host, URL encoding.\n";
}
