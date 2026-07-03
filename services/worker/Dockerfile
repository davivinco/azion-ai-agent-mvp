FROM node:22-alpine

WORKDIR /app

RUN apk add --no-cache sqlite

COPY services/worker/package.json ./package.json
RUN npm install

COPY services/worker ./

CMD ["npm", "run", "start"]
