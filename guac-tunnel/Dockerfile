FROM node:20-alpine

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY server.js ./

EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=3s --retries=5 \
    CMD node -e "require('net').connect(8080,'127.0.0.1').on('connect',()=>process.exit(0)).on('error',()=>process.exit(1))"

CMD ["node", "server.js"]
