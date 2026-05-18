FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY dist/ ./dist/
COPY examples/ ./examples/
ENV CONFIG_PATH=examples/minimal.yaml
CMD ["node", "dist/cli.js"]
