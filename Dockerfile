# Stage 1: Build Frontend
ARG NODE_IMAGE=docker.m.daocloud.io/library/node:22-alpine
FROM ${NODE_IMAGE} AS frontend-builder
ARG NPM_REGISTRY=https://registry.npmmirror.com
WORKDIR /frontend
COPY frontend/package*.json ./
RUN npm ci --registry=${NPM_REGISTRY}
COPY frontend/ ./
RUN npm run build

# Stage 2: Runner
FROM ${NODE_IMAGE}
ARG NPM_REGISTRY=https://registry.npmmirror.com
ARG ALPINE_MIRROR=https://mirrors.aliyun.com/alpine
# Install ffmpeg & ffprobe for media stream analysis
RUN sed -i "s|https://dl-cdn.alpinelinux.org/alpine|${ALPINE_MIRROR}|g" /etc/apk/repositories \
  && sed -i "s|http://dl-cdn.alpinelinux.org/alpine|${ALPINE_MIRROR}|g" /etc/apk/repositories \
  && apk add --no-cache ffmpeg
WORKDIR /app
COPY backend/package*.json ./
RUN npm ci --omit=dev --registry=${NPM_REGISTRY}
COPY backend/ ./
COPY --from=frontend-builder /frontend/dist ./public
# Create DB mount directory
RUN mkdir -p /app/data
EXPOSE 4010
VOLUME [ "/app/data" ]
ENV PORT=4010
ENV NODE_ENV=production
CMD [ "node", "server.js" ]
