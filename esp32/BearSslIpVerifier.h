#pragma once

#include <memory>
#include <new>
#include "TlsIpSan.h"

namespace eloto {

class BearSslIpVerifier {
    struct Dispatch {
        br_x509_class methods;
        BearSslIpVerifier *owner;
    } dispatch_{};

    const br_x509_class *original_ = nullptr;
    uint8_t ip_[4]{};
    std::unique_ptr<uint8_t[]> leaf_;
    size_t expected_ = 0;
    size_t received_ = 0;
    bool first_ = true;
    bool matches_ = false;

    static BearSslIpVerifier &self(const br_x509_class *const *ctx) {
        return *reinterpret_cast<const Dispatch *>(*ctx)->owner;
    }

    static void startChain(const br_x509_class **ctx, const char *) {
        auto &verifier = self(ctx);
        verifier.first_ = true;
        verifier.matches_ = false;
        verifier.leaf_.reset();
        verifier.original_->start_chain(ctx, nullptr);
    }

    static void startCert(const br_x509_class **ctx, uint32_t length) {
        auto &verifier = self(ctx);
        if (verifier.first_) {
            verifier.expected_ = length;
            verifier.received_ = 0;
            if (length > 0 && length <= 4096) {
                verifier.leaf_.reset(new (std::nothrow) uint8_t[length]);
            }
        }
        verifier.original_->start_cert(ctx, length);
    }

    static void append(const br_x509_class **ctx, const unsigned char *data, size_t length) {
        auto &verifier = self(ctx);
        if (verifier.first_ && verifier.leaf_) {
            if (length > verifier.expected_ - verifier.received_) {
                verifier.leaf_.reset();
            } else {
                std::memcpy(verifier.leaf_.get() + verifier.received_, data, length);
                verifier.received_ += length;
            }
        }
        verifier.original_->append(ctx, data, length);
    }

    static void endCert(const br_x509_class **ctx) {
        auto &verifier = self(ctx);
        verifier.original_->end_cert(ctx);
        if (verifier.first_) {
            verifier.matches_ = verifier.leaf_ &&
                verifier.received_ == verifier.expected_ &&
                certificateHasIpv4San(verifier.leaf_.get(), verifier.received_, verifier.ip_);
            verifier.leaf_.reset();
            verifier.first_ = false;
        }
    }

    static unsigned endChain(const br_x509_class **ctx) {
        auto &verifier = self(ctx);
        unsigned result = verifier.original_->end_chain(ctx);
        return result ? result : (verifier.matches_ ? 0 : BR_ERR_X509_BAD_SERVER_NAME);
    }

    static const br_x509_pkey *getKey(const br_x509_class *const *ctx, unsigned *usages) {
        return self(ctx).original_->get_pkey(ctx, usages);
    }

public:
    void setAddress(const uint8_t ip[4]) { std::memcpy(ip_, ip, sizeof(ip_)); }

    void install(br_x509_minimal_context *ctx) {
        original_ = ctx->vtable;
        dispatch_.methods = *original_;
        dispatch_.owner = this;
        dispatch_.methods.start_chain = startChain;
        dispatch_.methods.start_cert = startCert;
        dispatch_.methods.append = append;
        dispatch_.methods.end_cert = endCert;
        dispatch_.methods.end_chain = endChain;
        dispatch_.methods.get_pkey = getKey;
        ctx->vtable = &dispatch_.methods;
    }

    BearSslIpVerifier() = default;
    BearSslIpVerifier(const BearSslIpVerifier &) = delete;
    BearSslIpVerifier &operator=(const BearSslIpVerifier &) = delete;
};

}
