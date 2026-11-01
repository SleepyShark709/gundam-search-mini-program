# 个人机库升级 TODO

目标：优先新鲜感和吸引力，让用户能发现模型、展示阵容、邀请朋友参与，并持续记录拼装成果。

## 实现与验收

- [x] 首页发现：跨 HG/RG/MG/PG 搜索、近期发售、玩法入口；搜索支持中日英名称，空结果可恢复。
- [x] 分享直达：模型可直接打开；心愿单/收藏通过用户主动创建的公开快照分享，不包含个人购买金额；加载失败可重试。
- [x] 六机出击：从目录选 1–6 台、指定队长、编队命名、保存草稿、分享阵容、导出海报；访客能创建自己的阵容。
- [x] 胶佬默契局：创建三道选择题、分享给朋友、答题并查看分数；答题前接口不返回正确答案。
- [x] 堆积清零：购买记录关联多盒数量、拼装中/完成数量、今日目标和完成战报；失败不假报成功。
- [x] 机体谱系：首版人工维护少量有来源的机体关系；显示相关模型、拥有状态和收藏进度，不靠名称模糊匹配冒充谱系。
- [x] 两台 PK：手选两款，比较等级/比例/官方定价/发售时间/限定属性；可分享，明确不是市场行情。
- [x] 驾驶员评级：新增拼装评级不使用花费和购买频率，纳入拼装完成与收藏探索；按用户 2026-11-02 的补充要求，关闭新增评级时保留原收藏评级、雷达图和展开面板。
- [x] 回归验证：新增功能测试、原有测试、三端 TypeScript、ESLint、WXML/路由/样式检查；注明真机和线上数据库未验证的边界。
- [x] 交付：记录迁移与部署步骤，保留并提交已有工作区改动，推送 `codex/hangar-upgrades`。

## 范围说明

- 本次按用户确认一并保留、提交已有的未提交改动。
- 新玩法沿用现有深色机库视觉；暂不引入付费 AI、实时行情或泛社区。
- 提交代码和推送 Git 不等于发布微信小程序或迁移生产数据库；部署按文档执行。

## 2026-11-02 增量修复（本地验收完成）

- [x] 修复“载入更多”换行；真实分页到 80 条通过。最终原生渲染按钮与列表均宽 358px，按钮高 41px，`80 / 2247` 完整单行；提高局部选择器优先级，覆盖微信默认 184px 按钮宽度。
- [x] 兼容旧后端：实测线上 `/api/features`、`/api/builds` 均为 404；未支持的机库功能显示未开放，真实故障保留错误和重试，不伪报同步成功。启用但缺少迁移时服务端返回 `503 FEATURE_UNAVAILABLE`。
- [x] 个人页初次加载遮罩与已有资料刷新提示采用绝对定位；四种加载/失败渲染探针的基础菜单 top 387.5px、height 131px 均不变。最终重试按钮宽 48px，不再被微信默认宽度拉大。
- [x] 八项新功能由服务端配置统一控制；入口、直达、驻留页面及服务端读写均受控。全关时旧链接和进度接口均 403；单开机库恢复原有 3/1/1 进度。关闭保留数据、草稿和未保存输入；基础收藏购买继续可用。同一默契局回前台保留答案和判分结果。
- [x] 干净提交 `e260eff` 通过 263 项回归、12 项真实 MySQL、三端类型检查、lint 和 9/9 原生验收。后续 `03f5cb9` 仅改两份 LESS，定点渲染与官方预览另验通过。生成更新后端包，本轮代码和记录同步至 `codex/hangar-upgrades`；另一聊天的降本改动继续单独保留。

新增功能默认全部关闭，先发布一次支持开关的前端，再按 [服务端功能开关](UPGRADE_NOTES.md#服务端功能开关) 配置 `FEATURE_*` 并重启或发布 server。线上后端和迁移仍待用户手动部署，本地验收完成不代表发布 Goal 完成。

### 已购买展开面板回归修复（2026-11-02 完成）

用户明确要求保留原有雷达、驾驶员评级和展开明细，只由服务端开关控制新增拼装评级。

- [x] 新功能全关、配置不可用及拼装进度读取失败时，原收藏评级面板和展开操作仍可用。
- [x] 只有 `pilotRating`、`builds` 均开启且进度同步成功时切换到拼装评级；雷达标签、说明和得分使用同一模式。已知进度刷新期间明确显示暂用上次结果，读取失败立即回退原评级。
- [x] 配置刷新及模式切换保留展开状态和原购买列表；修复提交 `e677c06` 经回归与定点原生验收后，与本记录一同推送。

干净提交 `e677c06` 通过 269/269 测试、三端类型检查、全仓 lint 和后端构建。微信官方 SDK 的已购买页定点验收 5/5 通过、0 异常：全关真实点击展开，单开机库仍为收藏评级，双开成功切换拼装评级，真实 HTTP 503 后回退收藏评级，再关闭仍保留展开和购买记录。故障仅在随机本机数据库内临时重命名进度表，结束已还原并删除隔离库，独立核验剩余库为 0；测试 HTTP、临时 MySQL 和测试项目均已关闭。

本轮只验收受影响的已购买页，未重跑此前九组完整模拟器或开发预览。后端源码没有变化，已有 `e260eff` 上传包继续适用。2026-11-02 再次只读访问线上 `/api/features` 返回 401，客户端按配置不可用关闭新增功能；原收藏面板现不再受此影响，云端部署和真实微信调用仍待验证。

本轮证据：

- 干净回归、类型和 lint 日志：`/var/folders/fp/rjn9tn6x6fxfq78fsvkvysxw0000gn/T/gundam-rating-release-l9p4s_qz/logs/`。
- 定点原生报告与两张真实展开截图：`/var/folders/fp/rjn9tn6x6fxfq78fsvkvysxw0000gn/T/gundam-rating-release-l9p4s_qz/purchased-rating-native/result.json`。
- 源码、测试副本、后端和截图哈希核对及清理结果：`/var/folders/fp/rjn9tn6x6fxfq78fsvkvysxw0000gn/T/gundam-rating-release-l9p4s_qz/purchased-rating-verification.json`。

## 首次交付验证记录（`7dc7202` 之前）

- 2026-11-01：`npm test` 210/210 通过（原有回归与新增玩法/服务端/缓存测试）。
- `npm run typecheck`：小程序、server、admin 三端通过。
- `npm run lint`：通过；新增功能变更空白检查通过。暂存时发现原有两份报告的 Markdown 硬换行及 `load-state.less` 末尾空行，按范围要求保留。
- `npm --prefix server run build`：通过。
- 微信原生 WXML 编译器：29 个模板通过；Less + 原生 WXSS 编译器：30 个样式入口通过；11 个注册页面及组件引用完整。
- 独立审查发现并修复目录缓存降级掩盖断网状态的问题，补充真实 service 路径的回归测试。
- 未执行真实 MySQL 迁移、云托管部署或微信发布。未完成真机/模拟器视觉与分享验收：IDE 自动化服务端口关闭，且本机处于锁屏状态。

- 功能提交 `275d63b` 已推送至 `origin/codex/hangar-upgrades`；本条验收记录随后作为独立文档提交同步。

## Goal：发布前最终验收（进行中）

用户要求：完成修改与验证，必须在微信小程序模拟器验收，达到可直接发布水准。下面各项以当前状态证据为准，未勾选项不能视为通过。

- [x] 核对当前 Git：`codex/hangar-upgrades`，原功能提交 `275d63b`，验收文档提交 `7dc7202`。
- [x] 统一生产镜像与验证运行时（Node 22），后端构建通过。生产依赖 audit 从 5 项降至 0；仅指 `server --omit=dev`，不代表开发依赖审计为 0。本机没有 Docker，尚未执行 Linux 镜像构建；上传包另做干净 Node 22 安装、构建和启动验证。
- [x] 在隔离本地 MySQL 8.4.13 + 真实 HTTP 中通过 12/12 集成验收：迁移执行两次、账号隔离、六类分享、服务端答题、数量/日期与删除级联，以及全关基础 CRUD 和缺机库迁移的不可用响应；测试结束删除随机库。目录 SQL 基于旧版 2197 款执行两次，确认新增 50、改价 220、总计 2247；价格回退及用户/图片/旧快照哨兵均通过。
- [x] 微信官方自动化 SDK 在干净提交 `e260eff` 完成八项玩法和新增布局/开关组，9/9 通过，运行异常及未处理拒绝均为 0，进程退出 0；保存 104 张真实截图及 Canvas。真实点击、输入和隔离 MySQL 持久化核对完成，随机库已删除。最终 CSS 提交 `03f5cb9` 另以两张原生渲染图和实际尺寸复核。
- [x] 独立提交 `e260eff` 的干净副本通过 263/263 测试、12/12 真实 MySQL、三端类型检查、全仓 lint、后端构建；`03f5cb9` 仅两份 LESS 变化，已通过原生渲染和上传编译。此前 29 个 WXML 和 30 个 Less/WXSS 入口独立原生编译通过；新增组件随本轮 IDE 验收及预览编译。定向审查发现并修复回前台丢答案问题。
- [x] 最终 `03f5cb9` 干净副本保留 `FORCE_USE_CLOUD=true`，微信官方 CLI `preview` 上传及编译通过，退出 0；总包 1,775,645 字节（工具显示 1.7 MB），已生成开发预览二维码。开发预览不代表线上新后端、真机权限或正式发布已通过。
- [x] 生成包含当前后端与完整 2811 张图片的最新上传包及 SHA-256、文件清单，确认不含 `.env` 或旧构建。按清单逐文件核验，全新目录 Node 22 `npm ci`、构建、生产依赖裁剪、健康/鉴权/图片及默认全关配置启动检查通过；发布包源码提交为 `e260eff`，与 `03f5cb9` 的后端相同。
- [ ] 对齐云端后端与数据库部署状态；2026-11-01 只读检查显示线上 HG 1404、RG 176，仍是旧目录，公开分享读取返回身份错误，尚未更新机库后端。用户已确认尚未部署，将稍后手动操作。
- [ ] 完成云端身份边界验收：本地已收紧 source/AppID/OPENID 和重复头校验，生产禁止 mock 开关；但当前线上随机身份伪造请求仍返回 200。部署后必须 `npm run test:cloud-auth` 全部拒绝，并验证真实 `callContainer` 成功；来源头检查单独通过不能视为公网安全已解决。图片同公网域名，不能直接关闭全部公网。
- [x] 前轮验收记录 `82774ad` 已推送并核对远端；本轮追加功能开关与布局提交 `e260eff`、`03f5cb9`，与本记录同步至 `origin/codex/hangar-upgrades`。Git 推送不等于 Goal 完成，只有全部发布要求被当前证据证明，Goal 才能完成。

环境记录：用户已解锁 Mac 并开启服务端口，正式 CLI 已验证登录有效。本轮九组原生验收、最终 CSS 定点复核与开发预览均完成，相关测试工程和本机静态 stub 已关闭，临时 MySQL 已停止。仅通过官方 SDK/CLI 操作。验收使用独立提交的干净副本；另一聊天的降本改动原样留在主工作区，本轮未提交。已重新生成含功能开关的后端包，不能继续使用前轮 `1693e4e` 上传包。

真机与云端边界：尚未验证真实微信联系人发送、双账号切换、相册授权与图片转发权限、线上微信内容安全接口。最终模拟器使用隔离本机后端；不能据此宣称真实 `callContainer` 或线上部署已通过。

本机验收证据（2026-11-01）：

- 最终测试、类型、lint：`/tmp/gundam-final-unit.log`、`/tmp/gundam-final-types.log`、`/tmp/gundam-final-lint.log`。
- 最终独立提交的 231 项回归、类型检查与 lint：`/var/folders/fp/rjn9tn6x6fxfq78fsvkvysxw0000gn/T/gundam-release-snapshot-5KKQbS/logs/`。覆盖 SDK 未处理拒绝时的报告/清理、滚动稳定后才能点击，以及按真实渲染区域处理可见性。
- 最终原生 8/8 报告：`/var/folders/fp/rjn9tn6x6fxfq78fsvkvysxw0000gn/T/gundam-simulator-evidence-hAwgDo/result.json`；同目录保留 98 张真实截图及 `squad-canvas-export.png`。源码清单 SHA-256 为 `540d160ffeae279380ecd7a7abb4d8fd5034ca68f0db62b3773660022d75f864`，提交与哈希核验保存在 `/var/folders/fp/rjn9tn6x6fxfq78fsvkvysxw0000gn/T/gundam-release-snapshot-5KKQbS/verification.json`。
- 正式配置开发预览：`/var/folders/fp/rjn9tn6x6fxfq78fsvkvysxw0000gn/T/gundam-release-snapshot-5KKQbS/preview-info.json` 为官方 CLI 包大小输出，`preview-validation.json` 记录提交、云托管开关与文件哈希；同目录保留实际 JPEG 格式的 `preview-qr.jpg`。预览结束已正式关闭本次测试项目。
- 独立提交复核首轮启动超时，未进入业务，保留失败报告：`/var/folders/fp/rjn9tn6x6fxfq78fsvkvysxw0000gn/T/gundam-simulator-evidence-Kplh3P/result.json`。完成清库和正式关闭测试副本后，第一次重试通过全部八组。
- 真实 MySQL 与身份 HTTP 验收：`/var/folders/fp/rjn9tn6x6fxfq78fsvkvysxw0000gn/T/gundam-validation-evidence-5c1zqxir/mysql-integration.log`。
- 模板/样式原生编译：`/var/folders/fp/rjn9tn6x6fxfq78fsvkvysxw0000gn/T/gundam-final-native-h3vb2_eq/result.json`。
- 官方 SDK 模拟器实际启动失败，0/8，通过项为 0：`/var/folders/fp/rjn9tn6x6fxfq78fsvkvysxw0000gn/T/gundam-simulator-evidence-AiIidq/result.json`。
- 最新线上身份验收仍失败：`/var/folders/fp/rjn9tn6x6fxfq78fsvkvysxw0000gn/T/gundam-cloud-auth-evidence-Lh9END/result.json`；无身份 401，随机伪造 OPENID 及微信头均 200，尚不能勾选云端身份边界。
- 发布包干净安装与启动：`/var/folders/fp/rjn9tn6x6fxfq78fsvkvysxw0000gn/T/gundam-release-build-6ztlq6iw/result.json`。健康检查 200、未带身份及只带 OPENID 的私人请求均 401、图片 200、编译后的迁移脚本存在。
- 前轮上传包（已被 2026-11-02 新包替代）：`/Users/shark/WeChatProjects/gundam-menu-release/gundam-server-20261101T065622Z-5d383fa5b713.zip`（172555215 字节），对应清单同名 `.manifest.json`。
- ZIP SHA-256：`d0bb73c651f65fcc236b1cca839b3ec7a560383b4cdfb749955b660d05a9c8d3`。本轮旧中间包已清理；用户原有日期目录保留，但不用于本次发布。
- 收尾再次读取完整 ZIP 核对上述 SHA-256，结果一致；`git diff 1693e4e 1daf5ce -- server` 为空，确认该包仍对应已验收提交的后端源码。
- 原生首轮已实际生成截图，但完整结果为 0/8，保留失败证据：`/var/folders/fp/rjn9tn6x6fxfq78fsvkvysxw0000gn/T/gundam-simulator-evidence-ehZiko/result.json`。后续按真实渲染类修正虚拟组件定位，并修复六机编队卡片按钮文字裁切；最终结果以上述独立提交完整复核为准。
- 云托管控制台访问被浏览器安全策略阻止，不能代为操作或换途径绕过；用户已确认稍后按 `UPGRADE_NOTES.md`、`README.md` 手动部署，之后继续公网拒绝与真实微信调用验收。

本轮增量验收证据（2026-11-02，替代上述前轮包与最终代码记录）：

- 干净提交 `e260eff` 的 263 项回归、12 项真实 MySQL、类型与 lint 日志：`/var/folders/fp/rjn9tn6x6fxfq78fsvkvysxw0000gn/T/gundam-feature-release-_y0qg65z/logs/`。
- 9/9 真实业务与开关验收：`/var/folders/fp/rjn9tn6x6fxfq78fsvkvysxw0000gn/T/gundam-simulator-evidence-ssoQcw/result.json`；同目录保留 104 张截图。个人页状态注入仅证明渲染布局，业务与数据库流程使用真实隔离后端。
- 最终 CSS 原生尺寸、两张截图及哈希：`/var/folders/fp/rjn9tn6x6fxfq78fsvkvysxw0000gn/T/gundam-feature-release-_y0qg65z/layout-probe-03f5cb9/result.json`。该定点探针使用 `Page.setData` 和本机静态 503 stub，不计作新的业务验收。
- 最终预览、源码与截图哈希汇总：`/var/folders/fp/rjn9tn6x6fxfq78fsvkvysxw0000gn/T/gundam-feature-release-_y0qg65z/final-03f5cb9-verification.json`。原始云配置，包 1,775,645 字节；源码清单 SHA-256 为 `790b31374c9aa87d5fa3b30af3d11f0d70bd2e95c9fa89dacb1f430c3bb46d32`。
- 最新后端包：`/Users/shark/WeChatProjects/gundam-menu-release/gundam-server-20261101T161358Z-6dd6fb651ba2.zip`，172556203 字节，2844 个文件、2811 张图片，源码提交 `e260eff`；ZIP SHA-256 为 `37df5ab55ab3c17dc339f7ebcbe160f25127af3e5264576ffe2dd6c4f0afca79`。`LATEST.json` 已更新指向该包，文件名时间为 UTC。
- 最新包干净安装、构建、生产裁剪与运行证明：`/var/folders/fp/rjn9tn6x6fxfq78fsvkvysxw0000gn/T/gundam-feature-package-validation-l2gzla6u/result.json`。公开配置 200/no-store/八项默认关闭，未认证与仅 OPENID 私人请求 401，全关机库 403，图片 200，独立启用两项正常。仍未执行 Linux Docker 构建或云端部署。
