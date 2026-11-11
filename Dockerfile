# Stage 1: Build Client
FROM node:18-alpine AS client-builder
WORKDIR /app/client
COPY client/package*.json ./
RUN npm ci --no-audit --no-fund
COPY client/ .
RUN npm run build

# Stage 2: Build Server (需要 devDependencies：typescript / tsx)
FROM node:18-alpine AS server-builder
WORKDIR /app/server
COPY server/package*.json ./
COPY server/prisma ./prisma/
RUN npm ci --no-audit --no-fund
COPY server/ .
RUN npx prisma generate
RUN npm run build

# Stage 3: 仅运行时依赖（丢弃 typescript / tsx / prisma CLI 的构建缓存等）
# prisma CLI 会随 @prisma/client 一起保留，供容器启动时 prisma db push 使用
FROM node:18-alpine AS prod-deps
WORKDIR /app
COPY server/package*.json ./
COPY server/prisma ./prisma/
RUN npm ci --omit=dev --no-audit --no-fund && npx prisma generate

# Stage 4: Final Runner
FROM node:18-alpine
WORKDIR /app

# Prisma 查询引擎依赖 openssl
RUN apk add --no-cache openssl

ENV NODE_ENV=production

COPY --from=prod-deps /app/node_modules ./node_modules
COPY server/package*.json ./
COPY server/prisma ./prisma/
COPY --from=server-builder /app/server/dist ./dist

# 前端静态资源由服务端 express.static 提供
COPY --from=client-builder /app/client/dist ./public

RUN mkdir -p /app/data && chown -R node:node /app/data

EXPOSE 3000

CMD ["npm", "start"]
