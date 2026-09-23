#!/bin/sh
# SEC-06: generate a self-signed certificate at first run, and say plainly
# that it is one. Idempotent — an existing certificate (self-signed or the
# customer's own) is never overwritten, so this is safe to run on every
# `docker compose up`.
#
# To install the customer's own certificate instead, replace server.crt and
# server.key in the `tls` volume and restart the `web` service. See
# docs/runbooks/install-tls-certificate.md.
set -eu

# The init container is bare alpine; openssl is not in the base image.
if ! command -v openssl >/dev/null 2>&1; then
  apk add --no-cache openssl >/dev/null 2>&1 || {
    echo "xenitex: openssl is unavailable and could not be installed." >&2
    echo "xenitex: install a certificate manually at \$TLS_DIR/server.{crt,key}." >&2
    exit 1
  }
fi

TLS_DIR="${TLS_DIR:-/etc/nginx/tls}"
DAYS="${TLS_SELF_SIGNED_DAYS:-825}"
SUBJECT_CN="${TLS_SELF_SIGNED_CN:-xenitex-appliance}"

if [ -s "$TLS_DIR/server.crt" ] && [ -s "$TLS_DIR/server.key" ]; then
  echo "xenitex: TLS certificate already present at $TLS_DIR — leaving it alone."
  exit 0
fi

mkdir -p "$TLS_DIR"
openssl req -x509 -nodes -newkey rsa:4096 \
  -keyout "$TLS_DIR/server.key" \
  -out "$TLS_DIR/server.crt" \
  -days "$DAYS" \
  -subj "/CN=$SUBJECT_CN" \
  -addext "subjectAltName=DNS:$SUBJECT_CN,DNS:localhost,IP:127.0.0.1" \
  -addext "keyUsage=critical,digitalSignature,keyEncipherment" \
  -addext "extendedKeyUsage=serverAuth" 2>/dev/null

# The `web` container runs nginx as the unprivileged `nginx` user (uid 101
# in nginxinc/nginx-unprivileged) with `cap_drop: ALL`, so it cannot chown
# anything itself. A key left root:root 0600 is simply unreadable there and
# nginx fails to start — the same trap blobstore-init exists to avoid on the
# blob-store volume. Own it to that uid here, while we still are root.
NGINX_UID="${NGINX_UID:-101}"
chown "$NGINX_UID:0" "$TLS_DIR/server.key" "$TLS_DIR/server.crt"
chmod 600 "$TLS_DIR/server.key"
chmod 644 "$TLS_DIR/server.crt"

cat <<'WARNING'

  ************************************************************************
  *  WARNING: this appliance is using a SELF-SIGNED TLS certificate.      *
  *                                                                       *
  *  Browsers will show a certificate warning, and that warning is not    *
  *  noise — a self-signed certificate gives you encryption but NOT       *
  *  proof that you are talking to your appliance rather than to someone  *
  *  in between. Anyone able to intercept traffic on the path can present *
  *  their own self-signed certificate and you would see the same screen. *
  *                                                                       *
  *  Before the pilot goes live, install your organisation's own          *
  *  certificate: docs/runbooks/install-tls-certificate.md                *
  ************************************************************************

WARNING
