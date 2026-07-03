FROM node:22-alpine

WORKDIR /app

RUN apk add --no-cache sqlite

COPY apps/web/package.json ./package.json
RUN npm install

COPY apps/web ./
COPY packages/templates ../../packages/templates

EXPOSE 3000

CMD ["npm", "run", "dev"]
