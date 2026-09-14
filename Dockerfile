FROM node:20-bookworm

WORKDIR /app

COPY package*.json ./

RUN npm install --omit=dev

# Install Chromium and all required Linux dependencies
RUN npx playwright install --with-deps chromium

COPY server.js ./

ENV NODE_ENV=production

EXPOSE 3000

CMD ["node", "server.js"]
