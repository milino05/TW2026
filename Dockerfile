FROM node:22

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY clients/navigator/package*.json ./clients/navigator/
RUN npm ci --prefix clients/navigator --no-audit --no-fund

COPY . .

RUN npm run build:clients \
  && npm prune --omit=dev \
  && rm -rf clients/navigator/node_modules

ENV NODE_ENV=production
EXPOSE 8000

CMD ["npm", "start"]
