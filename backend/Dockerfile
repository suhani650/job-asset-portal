FROM node:20-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=development
COPY package*.json ./
# package-lock.json predates the merge (sequelize/pg added), so use install, not ci
RUN npm install --no-audit --no-fund
COPY . .
RUN npx prisma generate && mkdir -p uploads
ENV NODE_ENV=production
EXPOSE 4000
CMD ["sh", "-c", "npx prisma migrate deploy && npx tsx src/server.ts"]
