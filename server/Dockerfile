FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev
# 确保图片目录存在（构建前需先运行 update-data.ts 下载图片到 public/images/）
RUN mkdir -p public/images

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/public ./public
EXPOSE 80
CMD ["node", "dist/app.js"]
