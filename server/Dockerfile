FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build
# 确保图片目录存在（构建前需先运行 update-data.ts 下载图片到 public/images/）
RUN mkdir -p public/images
EXPOSE 80
CMD ["node", "dist/app.js"]
