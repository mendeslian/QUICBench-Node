# h2load do nghttp2 v1.70.0 com HTTP/3.
# Pinos do README desse tag (seção "Build HTTP/3 enabled h2load and nghttpx"):
#   aws-lc v5.4.0, nghttp3 v1.18.0, ngtcp2 v1.25.0.
# nghttp2 v1.70.0 exige C++23 (g++ >= 14). Sem mruby e sem libbpf: o binário
# da campanha é só o h2load.

FROM debian:trixie AS build

RUN apt-get update && apt-get install -y --no-install-recommends \
        autoconf \
        automake \
        build-essential \
        ca-certificates \
        cmake \
        g++ \
        git \
        libbrotli-dev \
        libc-ares-dev \
        libev-dev \
        libjansson-dev \
        libtool \
        libxml2-dev \
        make \
        pkg-config \
        zlib1g-dev \
    && rm -rf /var/lib/apt/lists/* \
    && g++ --version

WORKDIR /src

RUN git clone --depth 1 --branch v5.4.0 https://github.com/aws/aws-lc.git \
    && cmake -S aws-lc -B aws-lc/build -DDISABLE_GO=ON --install-prefix=/opt/aws-lc \
    && cmake --build aws-lc/build -j"$(nproc)" \
    && cmake --install aws-lc/build \
    && find /opt/aws-lc -name 'libssl.pc' -print

RUN git clone --depth 1 --branch v1.18.0 https://github.com/ngtcp2/nghttp3.git \
    && cd nghttp3 \
    && git submodule update --init --depth 1 \
    && autoreconf -i \
    && ./configure --prefix=/usr/local --enable-lib-only \
    && make -j"$(nproc)" \
    && make install

RUN git clone --depth 1 --branch v1.25.0 https://github.com/ngtcp2/ngtcp2.git \
    && cd ngtcp2 \
    && git submodule update --init --depth 1 \
    && SSL_LIB="$(dirname "$(dirname "$(find /opt/aws-lc -name libssl.pc | head -n 1)")")" \
    && test -n "${SSL_LIB}" \
    && autoreconf -i \
    && ./configure --prefix=/usr/local --enable-lib-only --with-boringssl \
        BORINGSSL_CFLAGS="-I/opt/aws-lc/include" \
        BORINGSSL_LIBS="-L${SSL_LIB} -lssl -lcrypto" \
    && make -j"$(nproc)" \
    && make install

RUN git clone --depth 1 --branch v1.70.0 https://github.com/nghttp2/nghttp2.git \
    && cd nghttp2 \
    && git submodule update --init --depth 1 third-party/urlparse \
    && SSL_LIB="$(dirname "$(dirname "$(find /opt/aws-lc -name libssl.pc | head -n 1)")")" \
    && autoreconf -i \
    && ./configure --prefix=/usr/local --enable-http3 \
        PKG_CONFIG_PATH="${SSL_LIB}/pkgconfig:/usr/local/lib/pkgconfig" \
        LDFLAGS="-Wl,-rpath,/usr/local/lib -Wl,-rpath,${SSL_LIB}" \
    && make -j"$(nproc)" \
    && make install \
    && h2load --help | grep -F -- '--h3' \
    && h2load --help | grep -F -- '--output-file'

FROM debian:trixie-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates \
        libbrotli1 \
        libc-ares2 \
        libev4 \
        libjansson4 \
        libxml2 \
        zlib1g \
    && rm -rf /var/lib/apt/lists/*

COPY --from=build /usr/local/bin/h2load /usr/local/bin/h2load
COPY --from=build /usr/local/lib /usr/local/lib
COPY --from=build /opt/aws-lc /opt/aws-lc

ENV LD_LIBRARY_PATH=/usr/local/lib:/opt/aws-lc/lib:/opt/aws-lc/lib64

RUN ldconfig || true \
    && h2load --help | grep -F -- '--h3' \
    && h2load --help | grep -F -- '--output-file' \
    && h2load --version

ENTRYPOINT ["h2load"]
