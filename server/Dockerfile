FROM node:22-bookworm-slim
WORKDIR /app
COPY package*.json ./
RUN npm install
ENV PLAYWRIGHT_BROWSERS_PATH=0
RUN npx playwright-core install --with-deps chromium
COPY . .
CMD ["node", "server.js"]