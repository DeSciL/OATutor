# syntax=docker/dockerfile:1

# Build the React app. The content submodule must be checked out: the problem
# pool is generated from it during `npm run build` and bundled in.
FROM node:20-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
# "@common/global-config" is a file: dependency, so it has to exist before install.
COPY common ./common
RUN npm ci
COPY . .
ARG COMMIT_HASH=""
# PUBLIC_URL overrides package.json's GitHub Pages homepage, which would prefix every asset with /OATutor.
ENV CI=false \
    PUBLIC_URL=/ \
    GENERATE_SOURCEMAP=false \
    REACT_APP_BUILD_TYPE=production \
    REACT_APP_COMMIT_HASH=$COMMIT_HASH \
    NODE_OPTIONS=--max-old-space-size=4096
RUN npm run build
# Ids the built-in content already uses, so imports can be checked against them.
RUN node server/scripts/writeBuiltinIndex.js generated/builtin-index.json

FROM node:20-bookworm-slim AS server-deps
WORKDIR /srv/server
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev

FROM node:20-bookworm-slim
ENV NODE_ENV=production \
    PORT=8080 \
    BUILD_DIR=/srv/build \
    DATA_DIR=/data \
    BUILTIN_INDEX=/srv/generated/builtin-index.json
WORKDIR /srv
COPY --from=build /app/build ./build
COPY --from=build /app/generated/builtin-index.json ./generated/
# The importer assembles uploaded problems with the same code the build uses.
COPY src/tools/buildProblemPool.js ./src/tools/
RUN mkdir /data && chown node:node /data
VOLUME /data
COPY --from=server-deps /srv/server/node_modules ./server/node_modules
COPY server ./server
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:8080/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "server/index.js"]
