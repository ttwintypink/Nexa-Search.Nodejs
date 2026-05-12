FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --include=dev

COPY . .
RUN npm run build && test -f dist/index.js

ENV NODE_ENV=production

CMD ["node", "index.js"]
