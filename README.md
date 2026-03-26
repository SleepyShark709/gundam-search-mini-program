# Gundam Menu 高达模型目录

A WeChat Mini Program for browsing Bandai Gundam plastic model (Gunpla) catalogs across HG, RG, MG, and PG series.

一款微信小程序，用于浏览万代高达塑料模型（HG/RG/MG/PG）产品目录，支持搜索、筛选、排序与收藏。

## Features 功能

- **Browse 浏览** — Swipe through 4 series (HG/RG/MG/PG) with 2197+ models | 轮播浏览四大系列，共收录 2197+ 款模型
- **Search 搜索** — Search by name (CN/JP/EN) and tags | 支持中/日/英名称及标签搜索
- **Filter 筛选** — Filter by release date, model number, limited type (P-Bandai, Gundam Base, Event, SIDE-F) | 按发售日期、编号、限定类型筛选
- **Sort 排序** — Sort by number, price, or release date | 按编号、价格、发售日期排序
- **Wishlist 心愿单** — Cloud-synced wishlist with optimistic updates | 云端同步心愿单，乐观更新
- **Purchase Tracking 购买记录** — Record price, date, channel, and notes | 记录购买价格、日期、渠道及备注
- **Price Conversion 价格换算** — Real-time JPY → CNY exchange rate | 实时日元→人民币汇率转换

## Tech Stack 技术栈

| Layer 层 | Technology 技术 |
|----------|-----------------|
| Renderer 渲染器 | Skyline |
| Component Framework 组件框架 | glass-easel |
| Language 语言 | TypeScript + Less |
| Backend 后端 | Express.js + MySQL |
| Deployment 部署 | WeChat Cloud Base (容器化) 微信云托管 |

## Project Structure 项目结构

```
├── miniprogram/
│   ├── app.ts / app.json / app.less    # App entry 应用入口
│   ├── pages/
│   │   ├── home/                       # Home carousel 首页轮播
│   │   ├── series/                     # Series detail 系列详情
│   │   ├── profile/                    # Profile 个人中心
│   │   ├── wishlist/                   # Wishlist 心愿单
│   │   └── purchased/                  # Purchased 已购买
│   ├── components/                     # 13 custom components 自定义组件
│   │   ├── model-card/                 # Model grid card 模型卡片
│   │   ├── model-detail/              # Model detail sheet 模型详情
│   │   ├── series-card/               # Series carousel card 系列卡片
│   │   ├── purchase-form/             # Purchase form 购买表单
│   │   ├── search-bar/                # Search input 搜索栏
│   │   ├── filter-panel/             # Filter panel 筛选面板
│   │   ├── sort-selector/            # Sort picker 排序选择
│   │   ├── category-tabs/            # Regular/Limited tabs 分类标签
│   │   ├── limited-filter/           # Limited type filter 限定筛选
│   │   ├── header/                    # Navigation header 导航栏
│   │   ├── price-display/            # Price display 价格展示
│   │   ├── favorite-button/          # Favorite toggle 收藏按钮
│   │   └── badge/                     # Limited badge 限定徽章
│   ├── data/                          # Static JSON data 静态数据
│   │   ├── hg.json                    # 1404 models
│   │   ├── rg.json                    # 176 models
│   │   ├── mg.json                    # 565 models
│   │   └── pg.json                    # 52 models
│   ├── utils/                         # Services & utilities 工具层
│   │   ├── model-service.ts           # Data access 数据访问
│   │   ├── cloud-favorites.ts         # Cloud wishlist 云心愿单
│   │   ├── purchase-service.ts        # Purchase service 购买服务
│   │   ├── api.ts                     # Cloud API wrapper 云 API 封装
│   │   ├── cdn-config.ts             # Image CDN rewrite 图片 CDN
│   │   ├── favorites.ts              # Local favorites 本地收藏
│   │   ├── types.ts                   # Type definitions 类型定义
│   │   └── migration.ts              # Data migration 数据迁移
│   ├── styles/
│   │   └── variables.less             # Theme variables 主题变量
│   └── assets/                        # TabBar icons 标签栏图标
├── server/                            # Backend service 后端服务
│   └── src/
│       ├── app.ts                     # Express entry Express 入口
│       ├── db/pool.ts                 # MySQL pool 数据库连接池
│       ├── routes/wishlist.ts         # Wishlist API 心愿单接口
│       ├── routes/purchases.ts        # Purchases API 购买记录接口
│       ├── middleware/auth.ts         # Auth middleware 认证中间件
│       └── scripts/
│           ├── scrape-bandai.ts       # Bandai website scraper 万代官网爬虫
│           ├── seed.ts                # DB data seeder 数据库初始化
│           ├── update-data.ts         # Data import + image download 数据导入
│           ├── download-images.ts     # Image downloader 图片下载
│           └── scrape-images.ts       # Multi-image scraper 多图爬虫
├── typings/                           # TypeScript declarations 类型声明
├── project.config.json                # WeChat DevTools config 开发工具配置
└── tsconfig.json
```

## Getting Started 开始使用

### Prerequisites 前置要求

- [WeChat DevTools 微信开发者工具](https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html)

### Development 开发

1. Clone the repository | 克隆仓库
2. Open the project root in WeChat DevTools | 用微信开发者工具打开项目根目录
3. TypeScript and Less are compiled automatically by DevTools | TS 和 Less 由开发者工具自动编译，无需手动构建

### Backend 后端

```bash
cd server
npm install
npm run dev
```

## Data Update 数据更新

Script to automatically scrape new products from Bandai's official website and update local JSON data files.

自动从万代官网爬取最新产品数据并更新本地 JSON 文件的脚本。

### Quick Start 快速开始

```bash
# 安装依赖（首次）
cd server && npm install

# 一键更新：爬取万代官网最新数据（默认扫描每个系列前 5 页）
npx ts-node src/scripts/scrape-bandai.ts
```

### Usage 用法

```bash
# 预览模式：只查看有哪些新产品，不写入文件
npx ts-node src/scripts/scrape-bandai.ts --dry-run

# 只更新指定系列
npx ts-node src/scripts/scrape-bandai.ts --series hg

# 全量扫描（爬取所有页面，首次使用或怀疑有遗漏时）
npx ts-node src/scripts/scrape-bandai.ts --full

# 强制更新已有产品的价格和发售日期
npx ts-node src/scripts/scrape-bandai.ts --force

# 同时同步到数据库（需要数据库连接）
npx ts-node src/scripts/scrape-bandai.ts --sync-db

# 组合使用
npx ts-node src/scripts/scrape-bandai.ts --series rg --max-pages 3 --dry-run
```

### Parameters 参数

| Parameter 参数 | Default 默认值 | Description 说明 |
|----------------|----------------|------------------|
| `--series <code>` | all | 只爬取指定系列 (hg/rg/mg/pg) |
| `--max-pages <n>` | 5 | 每个系列最多爬取页数，设 0 爬全部 |
| `--delay <ms>` | 1500 | 请求间隔毫秒数（避免被封 IP） |
| `--dry-run` | false | 只展示新产品，不写入文件 |
| `--full` | false | 全量爬取所有页面 |
| `--force` | false | 更新已有产品的价格和发售日期 |
| `--sync-db` | false | 同时更新数据库 |

### How It Works 工作原理

1. 从 `bandai-hobby.net/brand/{hg,rg,mg,pg}/` 列表页爬取产品信息
2. 与 `miniprogram/data/*.json` 中的现有数据对比，通过 `productUrl` 识别新产品
3. 连续 3 页无新产品时自动停止（增量模式高效）
4. 新产品自动分配 ID 和编号，写入对应的 JSON 文件并更新 `series-meta.json`
5. 可选通过 `--sync-db` 同步到 MySQL 数据库

### Other Data Scripts 其他数据脚本

```bash
# 将本地 JSON 数据导入数据库（初始化）
npx ts-node src/scripts/seed.ts

# 综合数据更新：JSON 导入 + 图片下载
npx ts-node src/scripts/update-data.ts

# 下载产品图片到本地
npx ts-node src/scripts/download-images.ts

# 爬取产品多图（详情页图片）
npx ts-node src/scripts/scrape-images.ts --skip-existing
```

## Design 设计

Sci-fi mecha dark theme with cyan accent (`#00d4ff`) and deep blue-black backgrounds (`#0a0e17`).

科技机甲风深色主题，主色调青蓝 (`#00d4ff`)，深蓝黑背景 (`#0a0e17`)。

## Architecture 架构

```
WeChat Mini Program ──wx.cloud.callContainer()──→ Cloud Base (Express) ──→ MySQL
微信小程序客户端                                      微信云托管                  数据库
```

- Model data is bundled as static JSON files | 模型数据以静态 JSON 打包在小程序内
- Exchange rate fetched from `open.er-api.com`, cached 24h | 汇率从 open.er-api.com 获取，缓存 24 小时
- Cloud API lazy-initialized on first call | 云 API 首次调用时懒初始化
- Image URLs rewritten from GitHub CDN to Bandai direct links for China accessibility | 图片 URL 从 GitHub CDN 重写为万代直链，确保国内可访问

## License 许可

Private project. All rights reserved. | 私有项目，保留所有权利。
