#!/usr/bin/env sh
set -eu

CERT_DIR="/etc/nginx/certs"
CERT_CRT="${CERT_DIR}/localhost.crt"
CERT_KEY="${CERT_DIR}/localhost.key"

mkdir -p "${CERT_DIR}"

if [ ! -f "${CERT_CRT}" ] || [ ! -f "${CERT_KEY}" ]; then
  echo "Generating self-signed TLS certs for localhost..."
  openssl req -x509 -nodes -newkey rsa:2048 \
    -keyout "${CERT_KEY}" \
    -out "${CERT_CRT}" \
    -days 365 \
    -subj "/CN=localhost" \
    -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"
fi

exec "$@"
