# mwader/curl-http3 removido do Hub; alpine/curl-http3 suporta arm64 (Apple Silicon).
FROM alpine/curl-http3:latest

USER root

RUN apk add --no-cache bash python3 2>/dev/null || \
    (apt-get update && apt-get install -y --no-install-recommends bash python3 && rm -rf /var/lib/apt/lists/*)

COPY benchmarks/http3/run-load.sh /usr/local/bin/run-load.sh
RUN chmod +x /usr/local/bin/run-load.sh

WORKDIR /bench
ENTRYPOINT ["/usr/local/bin/run-load.sh"]
