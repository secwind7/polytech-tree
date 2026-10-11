# syntax=docker/dockerfile:1

# 静态站点。构建阶段与 .github/workflows/deploy.yml 对齐：
# Node 22、npm ci、数据校验、tsc + vite。运行阶段只留下 dist/。
# 数据在构建时打进包，镜像不读取 .env，也没有后端。

FROM node:22-bookworm-slim AS build

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONDONTWRITEBYTECODE=1

RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /src

COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --no-audit --no-fund

# validate_data.py 会 import merge_research（溯源闸），并读取 data/research。
COPY index.html vite.config.ts tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
COPY data ./data

RUN python3 scripts/validate_data.py \
    && npm run build \
    && test -s dist/index.html \
    && find dist/assets -name '*.js' -size +100k | grep -q .

FROM nginxinc/nginx-unprivileged:1.27-alpine AS runtime

USER root

RUN rm -rf /usr/share/nginx/html/*

COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY docker/security-headers.conf /etc/nginx/snippets/security-headers.conf
COPY --from=build --chown=nginx:nginx /src/dist /usr/share/nginx/html
COPY --chown=nginx:nginx docker/50x.html /usr/share/nginx/html/50x.html

# 页面文件只读。nginx 的 pid 与临时文件写在 /tmp，不写文档根。
RUN chmod -R a-w /usr/share/nginx/html

USER nginx

LABEL org.opencontainers.image.title="polytech-tree" \
      org.opencontainers.image.description="人类科技树 3D 可视化静态站点" \
      org.opencontainers.image.source="https://github.com/secwind7/polytech-tree" \
      org.opencontainers.image.licenses="MIT AND CC-BY-4.0 AND CC-BY-SA-4.0"

EXPOSE 8080

HEALTHCHECK --interval=10s --timeout=3s --start-period=3s --retries=3 \
    CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
