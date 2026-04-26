# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

高达模型目录微信小程序（gundam-menu），用于浏览万代高达塑料模型（HG/RG/MG/PG）的产品信息，支持搜索、筛选、排序、心愿单和已购管理功能。

## 技术栈

- **前端**：微信小程序（WebView 渲染器 + glass-easel 组件框架），TypeScript + Less
- **后端**：Express + MySQL（腾讯云 CynosDB），部署在微信云托管
- 前端无外部 npm 运行时依赖，仅 `miniprogram-api-typings` 作为 devDependency

## 开发方式

使用**微信开发者工具**打开项目根目录进行开发和预览。TS 和 Less 由开发者工具自动编译，无需手动构建步骤。无 lint、test 配置。

### 本地调试 Server

`api.ts` 中 `USE_LOCAL` 已改为**自动检测**：通过 `wx.getAccountInfoSync()` 读取 `envVersion`，`develop` 走本地、`trial`/`release` 走云托管。**无需手动切换**，发布前也不用改回。如需在开发者工具中临时强制走云托管，把 `FORCE_USE_CLOUD` 改为 `true`。

启动本地 server：

1. 把 `LOCAL_BASE` 改为电脑当前局域网 IP（真机调试时不能用 localhost；获取：`ipconfig getifaddr en0`）
2. `cd server && sudo MYSQL_ADDRESS=<外网地址> MYSQL_USERNAME=root MYSQL_PASSWORD=<密码> npm run dev`（监听 80 端口需 root）
3. 确保手机和电脑在同一 WiFi

#### 本地调试的关键差异（不直观）

- **mock openid**：本地模式下 `callLocal` 在请求头注入 `X-WX-OPENID: local-dev-user`，所有用户数据都挂在这个 mock 用户名下，**与云上真实 openid 数据隔离**。本地看到心愿单/已购为空是正常的。
- **图片始终走云端**：`cdn-config.ts` 中的 `getImageBase()` 始终返回 `CONTAINER_DOMAIN`，因为本地 server 的 `public/images/` 通常是空的。API 走本地、图片走云端。
- **数据库连接**：本地 server 直连云上 CynosDB（外网地址），即可使用线上完整模型数据。

#### 数据库迁移脚本

不要直接改 `init.sql` 后期望生产库自动同步。需要手动在 `server/src/scripts/` 写迁移脚本（参考 `migrate-users.ts` 的幂等写法），用 `npx ts-node` 跑。`find-openids.ts` 可用于查询数据库中所有有数据的 openid。

## 架构

### 数据流

- 模型数据以静态 JSON 文件存储在 `miniprogram/data/` 目录（hg.json、rg.json、mg.json、pg.json）作为 L3 兜底
- `model-service.ts` 是数据访问层：L1 内存缓存 → L2 Storage 缓存（4 小时 TTL）→ L3 本地 JSON 兜底；页面加载时先用本地 JSON 同步渲染，再异步从 API 刷新
- **图片 URL 解析规则**（`cdn-config.ts`）：API 返回相对路径 `/images/...`，客户端根据环境拼接域名（本地 → `LOCAL_BASE`，线上 → `CONTAINER_DOMAIN`）；本地 JSON 兜底的 jsdelivr URL 重写为容器路径
- 汇率（JPY→CNY）在 `app.ts` 启动时从 `open.er-api.com` 获取，24 小时缓存于 `wx.Storage`

### 后端（server/）

- 云托管环境 ID: `prod-7gn6i50ma7c135ba`，服务名: `express-v0yz`
- 容器域名: `https://express-v0yz-233588-9-1411463139.sh.run.tcloudbase.com`
- API 通过 `wx.cloud.callContainer` 调用（内网免鉴权，自动注入 `X-WX-OPENID` 请求头），图片通过公网域名加载
- **API 返回图片路径为相对路径 `/images/...`，不拼接域名**，由客户端 `cdn-config.ts` 负责解析
- 产品图片存储在 `server/public/images/`，通过 Express 静态文件中间件提供服务
- `scrape-images.ts` 爬取万代官网多图，下载到 `public/images/{modelId}/` 并写入 `model_images` 表
- **认证模型**：公开 API（`/api/series-meta`、`/api/models/*`）不需认证；用户数据 API（`/api/wishlist`、`/api/purchases`）通过 `authMiddleware` 从 `X-WX-OPENID` 提取 openid 进行身份识别

### API 路由

- `GET /api/series-meta` — 系列元信息（公开）
- `GET /api/models/:seriesCode` — 模型列表（公开）
- `GET /api/models/:seriesCode/:modelId/images` — 模型多图（公开）
- `GET/POST/DELETE /api/wishlist` — 心愿单 CRUD（需认证）
- `POST /api/wishlist/batch` — 批量添加心愿单（迁移用，需认证）
- `GET/POST/PUT/DELETE /api/purchases` — 已购记录 CRUD（需认证）
- `GET/POST /api/user/profile` — 用户昵称和头像（需认证）

### 页面结构（5 个页面）

TabBar 页面（底部导航栏）：
- `pages/home` — 首页，展示系列卡片轮播（swiper），入口导航到 series
- `pages/profile` — "我的"页面，展示心愿单/已购计数，入口导航到 wishlist 和 purchased

非 TabBar 页面（通过 `wx.navigateTo` 打开）：
- `pages/series` — 系列详情页，接收 `?code=hg|rg|mg|pg` 参数，支持搜索/筛选/排序/收藏/模型详情弹窗
- `pages/wishlist` — 心愿单页面，展示所有已加入心愿单的模型
- `pages/purchased` — 已购页面，展示所有已购买的模型

### 心愿单与已购系统

- `cloud-favorites.ts` — 心愿单管理，通过 API 读写后端数据库，内存缓存 + 乐观更新
- `purchase-service.ts` — 已购记录管理，通过 API 读写后端数据库
- `favorites.ts` — 旧版本地收藏（基于 `wx.Storage`），仅用于迁移
- `migration.ts` — 一次性将旧版本地收藏迁移到云端心愿单

### 用户系统（昵称/头像）

- `user-service.ts` — 用户信息缓存层，与 wishlist/purchase 同模式（内存缓存 + API）
- **头像存储**：用户头像通过 `wx.cloud.uploadFile` 上传到**微信云存储**（不是 server 文件系统），数据库 `users.avatar_url` 存储的是云存储 fileID（`cloud://prod-xxx.xxx/avatars/xxx.jpg`）。微信 `<image>` 组件可直接渲染 fileID，无需转换。
- **采集方式**：`wx.getUserProfile` 已被微信废弃（返回灰色头像和"微信用户"占位）。必须用 `<button open-type="chooseAvatar">` 获取真实头像，`<input type="nickname">` 获取真实昵称。
- **不要把 `<input type="nickname">` 放进 `position: fixed` 的自定义弹窗**：WebView 模式下系统昵称面板与 fixed 元素层级冲突，面板事件无响应。profile 页面用的是页面内联表单方案。

### 样式

- `miniprogram/styles/variables.less` 定义全局 Less 变量（科技机甲风深色主题配色、间距、圆角、字号）
- 全局样式在 `miniprogram/app.less`
- 组件样式使用 Less 并通过 `@import` 引用 variables.less

### 2 列网格布局模式

series、wishlist、purchased 页面共用同一套网格布局方案：
- `.model-grid` 使用 `display: flex; flex-wrap: wrap`，每个 `model-card` 占 `width: 50%`
- `model-card` 的 `:host` 有 `padding: 6rpx` 作为卡片间距，`.model-grid` 用 `margin: 0 -6rpx` 负边距抵消外侧多余间距
- `.model-grid` 通过内联 style 设置 `padding: 0 24rpx` 作为页面左右边距
- **切勿在 `.scroll-area` 上额外添加水平 padding**，否则与 `.model-grid` 的 padding 叠加会导致内容偏移

### 类型系统

- `miniprogram/utils/types.ts` — 核心业务类型（GundamModel、SeriesMeta、FilterConfig、SortConfig、PurchaseRecord）
- `typings/index.d.ts` — IAppOption 全局接口定义

## 注意事项

- `packOptions` 中 `series-meta.json` 和 `id-migration.json` 被排除打包（它们有对应的 .js 文件用于 require）
- 小程序 appid: `wx422623fec834054c`
- **server/.dockerignore 不要排除 `public/images`**，否则 Docker 镜像中不含图片文件
- `USE_LOCAL` 已自动检测环境，无需发布前手动切换
- 数据库列名使用 snake_case，API 响应和前端使用 camelCase，server 端通过 `case-convert.ts` 转换
