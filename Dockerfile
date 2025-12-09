# syntax=docker/dockerfile:1.7-labs
FROM oven/bun:1.1 AS base
WORKDIR /app

COPY package.json ./
RUN bun install

COPY tsconfig.json ./
COPY src ./src
COPY resource-hub.config.example.json ./resource-hub.config.example.json

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    DATA_DIR=/data \
    DATABASE_FILE=downloads.db

EXPOSE 3000

CMD ["bun", "run", "src/server.ts"]
