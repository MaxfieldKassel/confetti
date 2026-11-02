# Alternative to the Nix-built image (`nix build .#dockerImage`).

FROM node:26-slim AS build
WORKDIR /usr/src/app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build && npm test && npm prune --omit=dev

FROM node:26-slim AS production
ENV NODE_ENV=production LOG_FORMAT=json PORT=80
WORKDIR /usr/src/app
COPY --from=build /usr/src/app/package.json ./
COPY --from=build /usr/src/app/node_modules ./node_modules
COPY --from=build /usr/src/app/dist ./dist
COPY --from=build /usr/src/app/private ./private
USER node
EXPOSE 80
CMD ["node", "private/server.js"]
