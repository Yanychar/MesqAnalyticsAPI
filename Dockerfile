FROM node:22-bookworm-slim AS base
RUN apt-get update && apt-get install -y openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM base AS deps
COPY package.json ./
RUN npm install --legacy-peer-deps

FROM deps AS build
COPY tsconfig*.json nest-cli.json ./
COPY prisma ./prisma
COPY config ./config
COPY clinicminds-openapi.json ./
COPY src ./src
RUN npx prisma generate
RUN npm run build

FROM base AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/config ./config
COPY --from=build /app/clinicminds-openapi.json ./
EXPOSE 3000
CMD ["sh", "-c", "npx prisma db push && node dist/main.js"]
