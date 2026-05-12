FROM node:20-alpine

WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build && test -f dist/index.js

CMD ["node", "dist/index.js"]
