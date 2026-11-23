FROM node:22-bookworm-slim
WORKDIR /app
COPY --chown=node:node package.json ./
COPY --chown=node:node backend/ ./backend/
COPY --chown=node:node frontend/ ./frontend/
RUN mkdir /data && chown node:node /data
USER node
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 DB_PATH=/data/solpan.sqlite
EXPOSE 3000
CMD ["node", "backend/server.js"]
