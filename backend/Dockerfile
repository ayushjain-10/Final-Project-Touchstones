# Touchstones backend (Express API). Runtime parity with the Render setup:
# Node 20, npm ci, node src/app.js, listens on PORT (default 3001), liveness at
# /health/live, readiness at /ready. Debian slim (not alpine): dd-trace ships
# native addons that expect glibc.
#
# Build context is the REPO ROOT (not backend/): emailTemplates.js resolves the
# branded templates at ../../../emails relative to src/services, so the image
# needs /emails alongside /app. Build with:
#   az acr build -r touchstonesacr -f backend/Dockerfile --image touchstone-api:dev .
FROM node:20-slim AS deps
WORKDIR /app
COPY backend/package.json backend/package-lock.json ./
# Keep package-lock.json complete or npm ci fails on dd-trace's optional
# @openfeature/* subtree (see PROJECT-DOCUMENTATION/07-DEPLOYMENT.md).
RUN npm ci --omit=dev

FROM node:20-slim
ENV NODE_ENV=production
WORKDIR /app
# ca-certificates: node:20-slim ships NO root CAs. Node's own TLS bundles its CA store,
# so HTTPS from JS works and this looks fine, but librdkafka (@confluentinc/kafka-javascript)
# uses OpenSSL and reads the SYSTEM store, so without this every SASL_SSL handshake to
# Confluent fails with "broker certificate could not be verified" and the event relay can
# never publish. Verified against the live cluster on 2026-07-14.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*
# --chown: host dir modes can be owner-only (root in the image), which makes
# require() fail as MODULE_NOT_FOUND for the non-root user. Own it all as node.
COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node backend/ ./
# Branded email templates, resolved at /emails by emailTemplates.js.
COPY --chown=node:node emails/ /emails/
# app.js mkdirSync's uploads/ at boot; /app itself is root-owned, so pre-create.
RUN mkdir -p /app/uploads && chown node:node /app/uploads
USER node
EXPOSE 3001
# Direct node (no npm wrapper) so SIGTERM reaches the app's graceful-shutdown
# handler (app.js drains for up to 10s); the host must allow that drain window.
CMD ["node", "src/app.js"]
