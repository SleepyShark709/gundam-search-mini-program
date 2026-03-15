# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

高达模型目录微信小程序（gundam-menu），用于浏览万代高达塑料模型（HG/RG/MG/PG）的产品信息，支持搜索、筛选、排序和收藏功能。

## 技术栈

- **微信小程序**（Skyline 渲染器 + glass-easel 组件框架）
- **TypeScript** + **Less**（通过微信开发者工具内置编译器插件编译，无需 npm build）
- 无外部 npm 运行时依赖，仅 `miniprogram-api-typings` 作为 devDependency

## 开发方式

使用**微信开发者工具**打开项目根目录进行开发和预览。TS 和 Less 由开发者工具自动编译，无需手动构建步骤。无 lint、test 配置。

## 架构

### 数据流

- 模型数据以静态 JSON 文件存储在 `miniprogram/data/` 目录（hg.json、rg.json、mg.json、pg.json），打包时包含在小程序包内
- `series-meta.json` / `series-meta.js` 存储系列元信息（名称、比例、封面、总数）
- `model-service.ts` 是数据访问层：通过 `wx.getFileSystemManager().readFileSync` 按需懒加载各系列数据并缓存
- 图片 URL 通过 `cdn-config.ts` 从 GitHub CDN 重写为微信云托管反代地址（国内可达）
- 汇率（JPY→CNY）在 `app.ts` 启动时从 `open.er-api.com` 获取，24 小时缓存于 `wx.Storage`

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
