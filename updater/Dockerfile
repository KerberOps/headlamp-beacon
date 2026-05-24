# ─── Beacon Updater ──────────────────────────────────────────────────────────
# CronJob: fetches latest versions from GitHub/GHCR, writes to ConfigMaps.
#
# Hardening:
#   - Python compiled to bytecode (.pyc), source removed
#   - Non-root user, read-only rootfs
#   - No pip, no compilers in final image
#
# Build: docker build --no-cache -t ghcr.io/<your-org>/beacon-updater:2.0.8 .
# Push:  docker push ghcr.io/<your-org>/beacon-updater:2.0.8
# ─────────────────────────────────────────────────────────────────────────────

FROM python:3.12-slim AS builder

ARG KUBERNETES_CLIENT_VERSION=29.0.0

RUN pip install --no-cache-dir \
      kubernetes==${KUBERNETES_CLIENT_VERSION}

WORKDIR /build
COPY update_versions.py .

# Compile to bytecode and remove source
RUN python -m compileall -b /build/ && \
    rm -f /build/update_versions.py

# ─── Final stage ─────────────────────────────────────────────────────────────
FROM python:3.12-slim

RUN groupadd --gid 1000 app && \
    useradd --uid 1000 --gid app --create-home --shell /sbin/nologin app

# Copy installed packages from builder
COPY --from=builder /usr/local/lib/python3.12/site-packages /usr/local/lib/python3.12/site-packages

WORKDIR /app

# Copy ONLY the compiled bytecode (.pyc), not the .py source
COPY --from=builder --chown=app:app /build/update_versions.pyc /app/update_versions.pyc

# Lock permissions — read+execute only, no write
RUN chmod 555 /app/update_versions.pyc && \
    rm -rf /usr/local/bin/pip* /usr/local/bin/easy_install* && \
    find /usr/local/lib -name "*.pyc" -path "*/pip/*" -delete

USER app:app

ENTRYPOINT ["python", "-u", "/app/update_versions.pyc"]

LABEL org.opencontainers.image.title="beacon-updater"
LABEL org.opencontainers.image.version="2.0.8"
LABEL org.opencontainers.image.description="Version fetcher for Beacon monitoring"
