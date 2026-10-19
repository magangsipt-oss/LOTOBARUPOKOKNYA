#pragma once

#include <WiFi.h>
#include <freertos/FreeRTOS.h>
#include <freertos/task.h>
#ifndef ENABLE_FS
#define ENABLE_FS
#endif
#include <ESP_SSLClient.h>
#include <time.h>
#include "ServerDefaults.h"
#include "BearSslIpVerifier.h"

namespace eloto {

class CooperativeWiFiClient : public WiFiClient {
public:
    int available() override {
        vTaskDelay(pdMS_TO_TICKS(1));
        return WiFiClient::available();
    }
};

class Ipv4SanStore : public bssl::CertStoreBase {
    BearSslIpVerifier verifier_;

public:
    void setAddress(IPAddress ip) {
        const uint8_t bytes[] = {ip[0], ip[1], ip[2], ip[3]};
        verifier_.setAddress(bytes);
    }

    void installCertStore(br_x509_minimal_context *ctx) override {
        verifier_.install(ctx);
    }
};

class LowMemoryTlsClient : public NetworkClient {
    CooperativeWiFiClient tcp_;
    Ipv4SanStore identity_;
    ESP_SSLClient tls_;
    bool tlsConnectionEstablished_ = false;

public:
    static constexpr size_t RX_BYTES = 16384;
    static constexpr size_t TX_BYTES = 512;

    explicit LowMemoryTlsClient(const char *host) {
        tls_.setClient(&tcp_, true);
        tls_.setCACert(DEFAULT_SERVER_CA);
        tls_.setX509Time(static_cast<uint32_t>(time(nullptr)));
        tls_.setBufferSizes(RX_BYTES, TX_BYTES);
        tls_.setSSLVersion(BR_TLS12, BR_TLS12);
        tls_.setHandshakeTimeout(6000);
        tls_.setTimeout(3);

        IPAddress address;
        if (address.fromString(host)) {
            identity_.setAddress(address);
            tls_.setCertStore(&identity_);
        }
    }

    int connect(const char *host, uint16_t port) override {
        tlsConnectionEstablished_ = tls_.connect(host, port) > 0;
        return tlsConnectionEstablished_ ? 1 : 0;
    }
    int connect(const char *host, uint16_t port, int32_t timeout) override {
        tlsConnectionEstablished_ = tls_.connect(host, port, timeout) > 0;
        return tlsConnectionEstablished_ ? 1 : 0;
    }
    int connect(IPAddress ip, uint16_t port) override {
        tlsConnectionEstablished_ = tls_.connect(ip, port) > 0;
        return tlsConnectionEstablished_ ? 1 : 0;
    }
    int connect(IPAddress ip, uint16_t port, int32_t timeout) override {
        tlsConnectionEstablished_ = tls_.connect(ip, port, timeout) > 0;
        return tlsConnectionEstablished_ ? 1 : 0;
    }
    void setConnectionTimeout(uint32_t milliseconds) override {
        tcp_.setConnectionTimeout(milliseconds);
    }
    void setTimeout(uint32_t milliseconds) {
        tls_.setTimeout((milliseconds + 999) / 1000);
        NetworkClient::setTimeout(milliseconds);
    }
    size_t write(uint8_t byte) override { return tls_.write(byte); }
    size_t write(const uint8_t *data, size_t size) override { return tls_.write(data, size); }
    int available() override { return tls_.available(); }
    int read() override { return tls_.read(); }
    int read(uint8_t *data, size_t size) override { return tls_.read(data, size); }
    int peek() override { return tls_.peek(); }
    void flush() override { tls_.flush(); }
    void clear() {
        while (tls_.available() > 0) {
            if (tls_.read() < 0) break;
        }
    }
    uint8_t connected() override { return tls_.connected(); }
    void stop() override {
        tls_.stop();
        tlsConnectionEstablished_ = false;
    }
    int fd() const override { return tcp_.fd(); }
    int lastError(char *error, size_t size) {
        if (!tlsConnectionEstablished_) {
            if (error && size > 0) snprintf(error, size, "TLS handshake did not complete");
            return -1;
        }
        return tls_.getLastSSLError(error, size);
    }
};

}
