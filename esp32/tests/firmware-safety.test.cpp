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
    assert(eloto::parseOfflineRecord("off-1234,REFUEL_END,AABB,0,0", 0, retried));
    assert(retried.eventId == "off-1234");
    assert(!eloto::parseOfflineRecord("bad/id,REFUEL_END,AABB,0,0", 0, retried));
    assert(!eloto::parseOfflineRecord("event-id,REFUEL_END,AABB,0,0,second-id", 0, retried));

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

    eloto::ServerEndpoint endpoint;
    assert(eloto::parseServerEndpoint("192.168.1.2:5002", endpoint));
    assert(endpoint.baseUrl == "http://192.168.1.2:5002/");
    assert(!endpoint.secure);
    assert(eloto::parseServerEndpoint("http://server.local:8080/", endpoint));
    assert(endpoint.baseUrl == "http://server.local:8080/");
    assert(!endpoint.secure);
    assert(eloto::parseServerEndpoint("https://eloto.example.com", endpoint));
    assert(endpoint.baseUrl == "https://eloto.example.com/");
    assert(endpoint.secure);
    for (const std::string host : {"", "http://", "http://user@evil.local",
        "http://server.local/path", "http://example.com", "http://intranet:5002", "server.example.com:5002",
        "server.local?redirect=evil", "server.local:0", "server.local:65536",
        "server.local:5002@evil.local", "server.local\r\nX-Test:evil", "server.local#evil", "server.local:abc",
        "https://server.local/path"}) {
        assert(!eloto::parseServerEndpoint(host, endpoint));
    }

    size_t wifiSlot = 99;
    eloto::WifiConfigField wifiField = eloto::WIFI_CONFIG_NONE;
    assert(eloto::parseIndexedWifiKey("WIFI_1_SSID", 5, wifiSlot, wifiField));
    assert(wifiSlot == 0 && wifiField == eloto::WIFI_CONFIG_SSID);
    assert(eloto::parseIndexedWifiKey("WIFI_5_PASS", 5, wifiSlot, wifiField));
    assert(wifiSlot == 4 && wifiField == eloto::WIFI_CONFIG_PASSWORD);
    for (const std::string key : {"WIFI_0_SSID", "WIFI_6_SSID", "WIFI_X_PASS", "WIFI_1_TOKEN", "SSID"}) {
        assert(!eloto::parseIndexedWifiKey(key, 5, wifiSlot, wifiField));
    }
    const std::string utf16leWifiKey = {
        static_cast<char>(0xff), static_cast<char>(0xfe),
        'W','\0','I','\0','F','\0','I','\0','_','\0','1','\0','_','\0',
        'S','\0','S','\0','I','\0','D','\0'
    };
    assert(eloto::normalizeConfigLine(utf16leWifiKey) == "WIFI_1_SSID");
    assert(eloto::normalizeConfigLine("\xef\xbb\xbfSERVER=http://192.168.137.104:5002\r") ==
           "SERVER=http://192.168.137.104:5002");
    assert(eloto::validDeviceId("BOX-ELOTO-1"));
    assert(eloto::validDeviceId("BOX ELOTO 1"));
    assert(!eloto::validDeviceId(" BOX ELOTO 1"));
    assert(!eloto::validDeviceId(std::string(101, 'a')));
    assert(eloto::validWifiSsid("ELOTO-IOT"));
    assert(!eloto::validWifiSsid(""));
    assert(!eloto::validWifiSsid(std::string(33, 'a')));
    assert(eloto::validWifiPassword("strong-wifi-password"));
    assert(!eloto::validWifiPassword("short"));
    assert(!eloto::validWifiPassword(std::string(64, 'a')));
    assert(eloto::encodePathComponent("BOX ELOTO 1") == "BOX%20ELOTO%201");
    assert(eloto::encodePathComponent("BOX/#?%") == "BOX%2F%23%3F%25");
    assert(eloto::encodePathComponent("valid-ID_1.~") == "valid-ID_1.~");
    std::cout << "Firmware host checks passed: replay identity/parsing, bounds, configured host, URL encoding.\n";
}
