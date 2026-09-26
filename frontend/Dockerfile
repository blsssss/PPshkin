FROM node:24.21.0-alpine3.24 AS build
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci --ignore-scripts
COPY index.html vite.config.ts tsconfig.json ./
COPY public ./public
COPY src ./src
ARG VITE_MAX_BOT_NAME=
ARG VITE_API_BASE_URL=
ARG VITE_DEMO_MODE=false
ENV VITE_MAX_BOT_NAME=$VITE_MAX_BOT_NAME \
    VITE_API_BASE_URL=$VITE_API_BASE_URL \
    VITE_DEMO_MODE=$VITE_DEMO_MODE
RUN npm run build

FROM nginxinc/nginx-unprivileged:1.30.5-alpine3.24 AS runtime
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=3 CMD wget -qO- http://127.0.0.1:8080/ >/dev/null || exit 1
