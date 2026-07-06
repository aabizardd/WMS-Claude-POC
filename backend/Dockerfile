# ---- Build stage ----
FROM node:20-alpine AS build
WORKDIR /app

# Install all deps (incl. dev) for building + Prisma CLI.
COPY package*.json ./
RUN npm ci

# Generate Prisma client (needs the schema), then build the Nest app.
COPY prisma ./prisma
RUN npx prisma generate
COPY . .
RUN npm run build

# ---- Runtime stage ----
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production

# Carry over the installed modules (includes generated Prisma client + CLI),
# the compiled output, and the migrations needed by `prisma migrate deploy`.
COPY package*.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma

EXPOSE 3000

# Apply pending migrations on boot, then start the server.
# (Run a single instance in production — the ERP sync scheduler uses setInterval.)
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main"]
