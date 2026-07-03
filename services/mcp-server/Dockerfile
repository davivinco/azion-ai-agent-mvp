FROM node:22-alpine

WORKDIR /app

COPY services/mcp-server/package.json ./package.json
RUN npm install

COPY services/mcp-server ./
COPY packages/templates ../../packages/templates

EXPOSE 3333

CMD ["npm", "run", "start"]
