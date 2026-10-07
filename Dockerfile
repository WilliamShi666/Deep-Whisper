FROM node:24.21.0-bookworm-slim AS build
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM node:24.21.0-bookworm-slim AS runtime
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate
WORKDIR /app
# Worker and supervisor use the same reviewed sources and pinned modules.
COPY --from=build /app/.next ./.next
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/src ./src
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/public ./public
COPY --from=build /app/package.json /app/tsconfig.json /app/next.config.ts /app/.env.example /app/.env.advanced.example ./
ENV NODE_ENV=production HOST=0.0.0.0 PORT=5000 APP_DATA_DIR=/data APP_ACCESS_MODE=password
RUN mkdir /data && chown node:node /data
USER node
EXPOSE 5000
CMD ["pnpm", "start"]
