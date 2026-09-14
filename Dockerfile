FROM node:20-bookworm

WORKDIR /app

COPY package*.json ./

RUN npm install --omit=dev

RUN npx playwright install --with-deps chromium

COPY server.js ./

ENV NODE_ENV=production
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

EXPOSE 3000

CMD ["node", "server.js"]
