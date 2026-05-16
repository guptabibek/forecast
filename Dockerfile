# syntax=docker/dockerfile:1

########################
# API build/runtime
########################
FROM node:20-bullseye-slim AS api-builder

WORKDIR /workspace/apps/api

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY apps/api/package*.json ./

RUN npm ci

COPY apps/api/prisma ./prisma
COPY apps/api ./

RUN npx prisma generate

# Large TS files + NestJS Swagger plugin need extra heap for compilation
ENV NODE_OPTIONS="--max-old-space-size=1536"
RUN npm run build
ENV NODE_OPTIONS=""

FROM node:20-bullseye-slim AS api-runtime

WORKDIR /app

COPY --from=api-builder /workspace/apps/api/package*.json ./
COPY --from=api-builder /workspace/apps/api/node_modules ./node_modules
COPY --from=api-builder /workspace/apps/api/dist ./dist
COPY --from=api-builder /workspace/apps/api/prisma ./prisma
COPY --from=api-builder /workspace/apps/api/ai-reporting ./ai-reporting
COPY scripts/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

RUN sed -i 's/\r$//' /usr/local/bin/docker-entrypoint.sh \
  && chmod +x /usr/local/bin/docker-entrypoint.sh

# Pre-create the raw-page storage directory with `node`-user ownership BEFORE
# switching USER. When docker-compose mounts an empty named volume at this
# path, the volume inherits this directory's ownership + permissions. Without
# this step, the named volume comes up root-owned and the Node process (uid
# 1000) cannot mkdir inside it → MargRawPageStorage emits EACCES on every
# page save → resume becomes unavailable for that sync run.
# Must stay in sync with MARG_RAW_PAGE_STORAGE_DIR in .env.docker / compose.
RUN mkdir -p /data/marg-raw-pages \
  && chown -R node:node /data \
  && chmod 755 /data /data/marg-raw-pages

USER node

EXPOSE 3000
CMD ["/bin/sh", "/usr/local/bin/docker-entrypoint.sh"]

########################
# Web build/runtime
########################
FROM node:20-alpine AS web-builder

WORKDIR /workspace/apps/web

COPY apps/web/package*.json ./

RUN npm ci

COPY apps/web ./

ARG VITE_API_URL=/api/v1
ENV VITE_API_URL=${VITE_API_URL}

RUN npm run build

FROM nginx:1.27-alpine AS web-runtime

COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=web-builder /workspace/apps/web/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
