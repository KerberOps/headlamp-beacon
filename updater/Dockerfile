# ─── Beacon Updater ──────────────────────────────────────────────────────────
# CronJob: fetches latest versions from GitHub/GHCR, writes to ConfigMaps.
#
# Hardening:
#   - Python compiled to bytecode (.pyc), source removed
#   - Non-root user, read-only rootfs
#   - No pip, no compilers in final image
#
# Build: docker build --network host --no-cache -t cidacc.azurecr.io/beacon-updater:2.1.1 .
# ─────────────────────────────────────────────────────────────────────────────

FROM python:3.12-alpine AS builder

RUN apk update && apk upgrade --no-cache

ARG KUBERNETES_CLIENT_VERSION=29.0.0

RUN pip install --upgrade --no-cache-dir pip && \
    pip install --no-cache-dir \
      kubernetes==${KUBERNETES_CLIENT_VERSION}

WORKDIR /build
COPY update_versions.py .

# Compile to bytecode and remove source
RUN python -m compileall -b /build/ && \
    rm -f /build/update_versions.py

# ─── Final stage ─────────────────────────────────────────────────────────────
FROM python:3.12-alpine

RUN apk update && apk upgrade --no-cache && rm -rf /var/cache/apk/*

RUN addgroup -g 1000 app && \
    adduser -u 1000 -G app -h /home/app -s /sbin/nologin -D app

# Copy installed packages from builder
COPY --from=builder /usr/local/lib/python3.12/site-packages /usr/local/lib/python3.12/site-packages

WORKDIR /app

# Copy ONLY the compiled bytecode (.pyc), not the .py source
COPY --from=builder --chown=app:app /build/update_versions.pyc /app/update_versions.pyc

# Lock permissions — read+execute only, no write; strip pip entirely (not needed at runtime)
RUN chmod 555 /app/update_versions.pyc && \
    rm -rf /usr/local/bin/pip* /usr/local/bin/easy_install* \
           /usr/local/lib/python3.12/site-packages/pip \
           /usr/local/lib/python3.12/site-packages/pip-*.dist-info && \
    find /usr/local/lib -name "*.pyc" -path "*/pip/*" -delete

USER app:app

ENTRYPOINT ["python", "-u", "/app/update_versions.pyc"]

LABEL org.opencontainers.image.title="beacon-updater"
LABEL org.opencontainers.image.version="2.1.1"
LABEL org.opencontainers.image.description="Version fetcher for Beacon monitoring"
