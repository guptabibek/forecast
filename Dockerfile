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
RUN npm run build

FROM node:20-bullseye-slim AS api-runtime

WORKDIR /app

COPY --from=api-builder /workspace/apps/api/package*.json ./
COPY --from=api-builder /workspace/apps/api/node_modules ./node_modules
COPY --from=api-builder /workspace/apps/api/dist ./dist
COPY --from=api-builder /workspace/apps/api/prisma ./prisma
COPY scripts/docker-entrypoint.sh /app/docker-entrypoint.sh

RUN chmod +x /app/docker-entrypoint.sh && chown -R node:node /app

USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/api/v1/health/live', (r) => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

CMD ["/app/docker-entrypoint.sh"]

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
