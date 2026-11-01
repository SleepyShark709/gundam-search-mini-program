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

# 增量更新并保存新品首图（默认扫描每个系列前 5 页，不写数据库）
npx ts-node src/scripts/scrape-bandai.ts --download-images
```

### Usage 用法

```bash
# 预览模式：只查看有哪些新产品，不写入文件
npx ts-node src/scripts/scrape-bandai.ts --dry-run

# 只更新指定系列
npx ts-node src/scripts/scrape-bandai.ts --series hg

# 完整更新本地目录、官方价格和新品首图（不连接数据库）
npx ts-node src/scripts/scrape-bandai.ts --full --update-prices --download-images

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
| `--update-prices` | false | 只更新已有产品价格，保留原发售日期 |
| `--download-images` | false | 下载新品首图到 `server/public/images/{id}/cover.jpg`，使用稳定相对路径 |
| `--sync-db` | false | 同时更新数据库 |

### How It Works 工作原理

1. 从 `bandai-hobby.net/brand/{hg,rg,mg,pg}/` 列表页爬取产品信息
2. 与 `miniprogram/data/*.json` 中的现有数据对比，通过 `productUrl` 识别新产品
3. 默认增量模式连续 3 页无新产品时停止；全量及价格更新模式扫描所选页数。解析包括官网指向 Premium Bandai 的限定商品，重复链接／完整同名商品去重
4. 新产品自动分配 ID 和编号，写入对应 JSON，同时更新 `series-meta.json` 与小程序实际加载的 `series-meta.js`；旧 ID 和中文名保持不变
5. 可选通过 `--sync-db` 同步到 MySQL 数据库

长期未更新时推荐上面的完整命令。`--force` 会覆盖发售年月，官网再版月份可能与原发售年月不同，因此日常更新优先用 `--update-prices`。`--dry-run` 不写文件、不下载图片、不连接数据库。抓取或图片验证失败会返回非零退出码，不能把失败当作“没有新品”。

这里的价格是官方日元含税标价，人民币显示为汇率折算；脚本不提供市场行情或往年价格。新条目先保留官方日文名，中文名需核对后补充。

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

### 本次更新如何发布（2026-11-01）

本地更新结果：新增 **50** 款、官方价格更新 **220** 款，共 **2,247** 款；包含此前遗漏及官网已公布的预定商品。新增 50 张首图均已保存并校验。现有 ID、中文名、发售日期及其他非价格字段未改；新增名称暂用官方日文名。

| 系列 | 更新前 | 新增 | 更新后 | 官方改价 |
|---|---:|---:|---:|---:|
| HG | 1404 | 33 | 1437 | 128 |
| RG | 176 | 9 | 185 | 23 |
| MG | 565 | 6 | 571 | 67 |
| PG | 52 | 2 | 54 | 2 |

已准备本地后端上传包：`/Users/shark/WeChatProjects/gundam-menu-release-2026-11-01/gundam-server-2026-11-01.zip`（约 165 MiB）。包内根目录直接是 `Dockerfile`，包含完整产品图片，不含 `.env`、`node_modules` 或旧 `dist`。这是本次代码快照；后续再改 server 或图片，需要重新打包。变更详情、价格前后值和图片 SHA-256 见 [`manifest.json`](server/data-updates/2026-11-01/manifest.json)。**本地更新和打包已完成，尚未执行线上数据库导入或云端发布。**

本地目录、云上 MySQL、后端图片、小程序前端是四份不同的内容。只点开发者工具“上传”，不会把 JSON 导入 MySQL，也不会上传后端图片。

建议顺序：**先发布后端图片 → 导入目录 SQL → 验证云端 → 上传并发布小程序**。不要重新运行 `init.sql` 或用 `seed.ts` 替代本次增量文件，它们不适合保留线上已有图片路径和人工修改。

1. **准备并检查。** 使用 Node 22，在项目根目录执行 `npm run typecheck`、`npm run lint`、`npm test`。本项目路径为 `/Users/shark/WeChatProjects/gundam-menu`。先在数据库控制台备份 `models`、`series_meta` 两张目录表；这次无需导出或改动用户资料、心愿单、已购表。
2. **发布后端及图片。** 手动登录[微信云托管控制台](https://cloud.weixin.qq.com/)，进入当前生产环境，选择已有服务 **`express-v0yz`**，进入“版本列表／新建版本”，使用本地代码上传。上传根目录应是 **`/Users/shark/WeChatProjects/gundam-menu/server`**，根下直接有 `Dockerfile`、`package.json`、`src`、`public/images`；端口为 **80**，沿用现有数据库环境变量、域名和服务名。代码包不要包含本机 `.env`、`node_modules`、旧 `dist`；**必须包含完整 `public/images`**，不能只传本次新增图片，否则旧图片可能消失。构建与健康检查成功后按控制台流程发布到现有服务。若线上设置了 `IMAGE_STORAGE_PATH` 挂载目录，应将新增图片复制到那个目录；镜像内的 `public/images` 不会自动出现在挂载目录。
3. **导入本次目录增量。** 在对应生产 MySQL 的 SQL 管理工具中，选中现有业务数据库，执行 [`server/data-updates/2026-11-01/apply.sql`](server/data-updates/2026-11-01/apply.sql)。先看文件内的冲突预检，再执行事务部分。此文件只新增目录、更新匹配旧值的官方价格并按数据库实际条数刷新系列统计，不修改 `users`、`wishlists`、`purchases`、`model_images`，也不删除旧模型。已有名称、日期、图片路径保持不变。预检有冲突或执行有错误时先停下，不强制覆盖。
4. **验证云端。** SQL 末尾会返回各系列实际数量和本批条目检查结果。开发者工具重新编译，分别打开 HG／RG／MG／PG，确认新品和图片可见；用真机体验版复核心愿单、已购买和资料同步。页面进入时会异步刷新目录；若显示旧缓存，返回后重新进入并等待接口完成，**无需清除用户收藏**。新图 404 时先检查服务版本、完整图片包及 `IMAGE_STORAGE_PATH`，不要删用户数据。
5. **发布前端。** 微信开发者工具打开项目**根目录**（不是 `server`），确认底部为“浏览／我的”，并保留 `api.ts` 中 `FORCE_USE_CLOUD = true`。点击右上角“上传”，填写递增版本号及“更新模型目录、加载重试和样式修复”等说明。登录[微信公众平台](https://mp.weixin.qq.com/)，进入“小程序 → 管理 → 版本管理”，将开发版本设为体验版，真机检查后“提交审核”；审核通过后再点击“发布”。**上传成功不等于正式版已发布。** 小程序前端发布还会带上本地目录兜底和此前 UI 修复。

仅目录数据更新时，第 2–4 步完成后，已有正式版即可从 API 获取新品；本轮同时改了前端，因此第 5 步也需要执行。云托管版本流程可参考[官方版本文档](https://developers.weixin.qq.com/miniprogram/dev/wxcloudrun/src/guide/service/version.html)，前端流程参考[官方发布说明](https://developers.weixin.qq.com/miniprogram/dev/framework/quickstart/release.html)；按钮名称可能随控制台调整，以实际界面为准。

**回退：**后端可将流量切回旧版本；不要删除已有图片或新增目录行（发布后可能已有用户收藏）。仅恢复本批官方价格时，使用同目录下 `rollback-prices.sql`；它只恢复仍等于本次新价的记录。需要完整恢复目录时使用发布前备份，并先确认不会破坏新产生的收藏关联。

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

## 个人机库升级

新增首页发现、可直达分享、六机阵容、胶佬默契局、机库整备、精选机体关系和两台 PK。逐项验收见 [TODO.md](TODO.md)，新表迁移、部署顺序、公开范围和原生验收见 [UPGRADE_NOTES.md](UPGRADE_NOTES.md)。部署新版后端前须运行 `server/src/scripts/migrate-hangar.ts`；Git 推送不执行生产数据库迁移或微信发布。
