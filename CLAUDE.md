# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

高达模型目录微信小程序（gundam-menu），用于浏览万代高达塑料模型（HG/RG/MG/PG）的产品信息，支持搜索、筛选、排序和收藏功能。

## 技术栈

- **前端**：微信小程序（Skyline 渲染器 + glass-easel 组件框架），TypeScript + Less
- **后端**：Express + MySQL，部署在微信云托管
- 前端无外部 npm 运行时依赖，仅 `miniprogram-api-typings` 作为 devDependency

## 开发方式

使用**微信开发者工具**打开项目根目录进行开发和预览。TS 和 Less 由开发者工具自动编译，无需手动构建步骤。无 lint、test 配置。

### 本地调试 Server

1. 将 `api.ts` 顶部 `USE_LOCAL` 改为 `true`，`LOCAL_BASE` 改为电脑局域网 IP（真机调试时不能用 localhost）
2. 启动本地 server：`cd server && MYSQL_ADDRESS=<外网地址> MYSQL_USERNAME=root MYSQL_PASSWORD=<密码> npm run dev`
3. server 监听端口 80，确保手机和电脑在同一 WiFi
4. 发布前务必将 `USE_LOCAL` 改回 `false`

## 架构

### 数据流

- 模型数据以静态 JSON 文件存储在 `miniprogram/data/` 目录（hg.json、rg.json、mg.json、pg.json）作为 L3 兜底
- `model-service.ts` 是数据访问层：L1 内存缓存 → L2 Storage 缓存 → L3 本地 JSON 兜底；页面加载时先用本地 JSON 同步渲染，再异步从 API 刷新
- **图片 URL 解析规则**（`cdn-config.ts`）：API 返回相对路径 `/images/...`，客户端根据环境拼接域名（本地 → `LOCAL_BASE`，线上 → `CONTAINER_DOMAIN`）；本地 JSON 兜底的 jsdelivr URL 重写为万代官网直链
- 汇率（JPY→CNY）在 `app.ts` 启动时从 `open.er-api.com` 获取，24 小时缓存于 `wx.Storage`

### 后端（server/）

- Express + MySQL（腾讯云 CynosDB），部署在微信云托管，服务名 `express-v0yz`
- 云托管环境 ID: `prod-7gn6i50ma7c135ba`，容器域名: `https://express-v0yz-233588-9-1411463139.sh.run.tcloudbase.com`
- API 通过 `wx.cloud.callContainer` 调用（内网免鉴权），图片通过公网域名加载
- **API 返回图片路径为相对路径 `/images/...`，不拼接域名**，由客户端 `cdn-config.ts` 负责解析
- 产品图片存储在 `server/public/images/`，通过 Express 静态文件中间件提供服务
- `scrape-images.ts` 爬取万代官网多图，下载到 `public/images/{modelId}/` 并写入 `model_images` 表

### 页面结构（3 个页面）

- `pages/home` — 首页，展示系列卡片轮播（swiper），入口导航到 series 和 favorites
- `pages/series` — 系列详情页，接收 `?code=hg|rg|mg|pg` 参数，支持搜索/筛选/排序/收藏/模型详情弹窗
- `pages/favorites` — 收藏页，展示所有已收藏模型

### 收藏系统

- `favorites.ts` 管理收藏，基于 `wx.Storage`，存储模型 ID 数组
- `id-migration.ts/json` 处理旧版 ID 到新版 ID 的一次性迁移

### 组件

所有自定义组件位于 `miniprogram/components/`，每个组件包含标准四件套（.ts/.wxml/.less/.json）。核心组件：model-card、model-detail、series-card、filter-panel、search-bar、sort-selector、category-tabs、limited-filter、badge、price-display、favorite-button、header。

### 样式

- `miniprogram/styles/variables.less` 定义全局 Less 变量（科技机甲风深色主题配色、间距、圆角、字号）
- 全局样式在 `miniprogram/app.less`
- 组件样式使用 Less 并通过 `@import` 引用 variables.less

### 类型系统

- `miniprogram/utils/types.ts` — 核心业务类型（GundamModel、SeriesMeta、FilterConfig、SortConfig）
- `typings/index.d.ts` — IAppOption 全局接口定义
- `typings/types/` — 微信 API 类型声明

## 注意事项

- `packOptions` 中 `series-meta.json` 和 `id-migration.json` 被排除打包（它们有对应的 .js 文件用于 require）
- Skyline 渲染器与 WebView 有布局差异，修改样式时需注意兼容性（`defaultDisplayBlock: true`）
- 小程序 appid: `wx422623fec834054c`
- **server/.dockerignore 不要排除 `public/images`**，否则 Docker 镜像中不含图片文件
- 发布前确认 `api.ts` 中 `USE_LOCAL = false`
