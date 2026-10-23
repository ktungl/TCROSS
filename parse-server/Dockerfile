FROM node:22-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY index.js ./
# cloud/main.js 由 scripts/deploy.sh 從專案根目錄複製進來
COPY cloud ./cloud

USER node
ENV NODE_ENV=production PORT=8080
CMD ["node", "index.js"]
