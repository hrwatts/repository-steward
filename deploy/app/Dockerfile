FROM node:22-bookworm-slim@sha256:e9f565d32859f0cbfb52125eafe8be39390f24dac302dc3cdf566e8ba3ab21ee AS build

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json tsconfig.json ./
RUN npm ci

COPY apps ./apps
COPY packages ./packages
COPY types ./types
COPY policy-schema ./policy-schema
COPY examples ./examples

RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim@sha256:e9f565d32859f0cbfb52125eafe8be39390f24dac302dc3cdf566e8ba3ab21ee AS runtime

ENV NODE_ENV=production
WORKDIR /app

COPY --from=build --chown=node:node /app/package.json /app/package-lock.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/policy-schema ./policy-schema
COPY --from=build --chown=node:node /app/examples ./examples

RUN mkdir -p /app/.data /app/artifacts/runs && chown -R node:node /app/.data /app/artifacts

USER node

EXPOSE 3000
CMD ["node", "dist/apps/probot-server/src/server.js"]
