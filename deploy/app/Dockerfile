FROM node:22-bookworm-slim

WORKDIR /app

COPY package.json tsconfig.json ./
COPY apps ./apps
COPY packages ./packages
COPY types ./types
COPY policy-schema ./policy-schema
COPY examples ./examples

RUN npm install

CMD ["npm", "run", "start:probot"]
