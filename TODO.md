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
- [x] 驾驶员评级：移除花费和购买频率奖励，纳入拼装完成与收藏探索；旧购买记录正常兼容。
- [x] 回归验证：新增功能测试、原有测试、三端 TypeScript、ESLint、WXML/路由/样式检查；注明真机和线上数据库未验证的边界。
- [x] 交付：记录迁移与部署步骤，保留并提交已有工作区改动，推送 `codex/hangar-upgrades`。

## 范围说明

- 本次按用户确认一并保留、提交已有的未提交改动。
- 新玩法沿用现有深色机库视觉；暂不引入付费 AI、实时行情或泛社区。
- 提交代码和推送 Git 不等于发布微信小程序或迁移生产数据库；部署按文档执行。

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
- [x] 在隔离本地 MySQL 8.4.13 + 真实 HTTP 中通过 10/10 集成验收：迁移执行两次、账号隔离、六类分享、服务端答题、数量/日期与删除级联；测试结束删除随机库。目录 SQL 基于旧版 2197 款执行两次，确认新增 50、改价 220、总计 2247；价格回退及用户/图片/旧快照哨兵均通过。
- [x] 用微信官方自动化 SDK 在原生模拟器走完八项升级：独立提交 `1daf5ce` 的干净副本 8/8 通过，运行异常及未处理拒绝均为 0，进程退出 0。保存 98 张真实截图及 900×1360 Canvas，清单和哈希核验通过；真实点击、输入与隔离 MySQL 持久化核对完成，随机库已删除。
- [x] 独立提交 `1daf5ce` 的干净副本通过 231/231 测试、三端类型检查、全仓 lint、后端构建；此前 29 个 WXML 和 30 个 Less/WXSS 入口原生编译通过。独立审查未发现新增发布阻断问题。
- [x] 生成包含当前后端与完整 2811 张图片的最新上传包及 SHA-256、文件清单，确认不含 `.env` 或旧构建。按清单逐文件核验，全新目录 Node 22 `npm ci`、构建、生产依赖裁剪、健康/鉴权/图片启动检查通过；发布包源码提交为 `1693e4e`。
- [ ] 对齐云端后端与数据库部署状态；2026-11-01 只读检查显示线上 HG 1404、RG 176，仍是旧目录，公开分享读取返回身份错误，尚未更新机库后端。用户已确认尚未部署，将稍后手动操作。
- [ ] 完成云端身份边界验收：本地已收紧 source/AppID/OPENID 和重复头校验，生产禁止 mock 开关；但当前线上随机身份伪造请求仍返回 200。部署后必须 `npm run test:cloud-auth` 全部拒绝，并验证真实 `callContainer` 成功；来源头检查单独通过不能视为公网安全已解决。图片同公网域名，不能直接关闭全部公网。
- [x] 验收加固提交 `1693e4e` 已推送并核对远端；本轮追加修复提交 `1daf5ce`，与本记录同步至 `origin/codex/hangar-upgrades`。Git 推送不等于 Goal 完成，只有全部发布要求被当前证据证明，Goal 才能完成。

环境记录：用户已解锁 Mac 并开启服务端口，正式 CLI 已验证登录有效。真实原生模拟器八组验收已完成；早期失败轮次和局部诊断不计入通过。仅通过官方 SDK/CLI 操作。收尾时发现另一聊天的降本改动，因此最终验收使用独立提交的干净副本；降本改动原样留在主工作区，本轮未提交。当前后端上传包对应的源码不受这次前端及验收脚本修复影响。

真机与云端边界：尚未验证真实微信联系人发送、双账号切换、相册授权与图片转发权限、线上微信内容安全接口。最终模拟器使用隔离本机后端；不能据此宣称真实 `callContainer` 或线上部署已通过。

本机验收证据（2026-11-01）：

- 最终测试、类型、lint：`/tmp/gundam-final-unit.log`、`/tmp/gundam-final-types.log`、`/tmp/gundam-final-lint.log`。
- 最终独立提交的 231 项回归、类型检查与 lint：`/var/folders/fp/rjn9tn6x6fxfq78fsvkvysxw0000gn/T/gundam-release-snapshot-5KKQbS/logs/`。覆盖 SDK 未处理拒绝时的报告/清理、滚动稳定后才能点击，以及按真实渲染区域处理可见性。
- 最终原生 8/8 报告：`/var/folders/fp/rjn9tn6x6fxfq78fsvkvysxw0000gn/T/gundam-simulator-evidence-hAwgDo/result.json`；同目录保留 98 张真实截图及 `squad-canvas-export.png`。源码清单 SHA-256 为 `540d160ffeae279380ecd7a7abb4d8fd5034ca68f0db62b3773660022d75f864`，提交与哈希核验保存在 `/var/folders/fp/rjn9tn6x6fxfq78fsvkvysxw0000gn/T/gundam-release-snapshot-5KKQbS/verification.json`。
- 独立提交复核首轮启动超时，未进入业务，保留失败报告：`/var/folders/fp/rjn9tn6x6fxfq78fsvkvysxw0000gn/T/gundam-simulator-evidence-Kplh3P/result.json`。完成清库和正式关闭测试副本后，第一次重试通过全部八组。
- 真实 MySQL 与身份 HTTP 验收：`/var/folders/fp/rjn9tn6x6fxfq78fsvkvysxw0000gn/T/gundam-validation-evidence-5c1zqxir/mysql-integration.log`。
- 模板/样式原生编译：`/var/folders/fp/rjn9tn6x6fxfq78fsvkvysxw0000gn/T/gundam-final-native-h3vb2_eq/result.json`。
- 官方 SDK 模拟器实际启动失败，0/8，通过项为 0：`/var/folders/fp/rjn9tn6x6fxfq78fsvkvysxw0000gn/T/gundam-simulator-evidence-AiIidq/result.json`。
- 线上身份验收失败：`/var/folders/fp/rjn9tn6x6fxfq78fsvkvysxw0000gn/T/gundam-cloud-auth-evidence-0wWaVF/result.json`。
- 发布包干净安装与启动：`/var/folders/fp/rjn9tn6x6fxfq78fsvkvysxw0000gn/T/gundam-release-build-6ztlq6iw/result.json`。健康检查 200、未带身份及只带 OPENID 的私人请求均 401、图片 200、编译后的迁移脚本存在。
- 当前上传包：`/Users/shark/WeChatProjects/gundam-menu-release/gundam-server-20261101T065622Z-5d383fa5b713.zip`（172555215 字节），对应清单同名 `.manifest.json`，最新指针为该目录的 `LATEST.json`。
- ZIP SHA-256：`d0bb73c651f65fcc236b1cca839b3ec7a560383b4cdfb749955b660d05a9c8d3`。本轮旧中间包已清理；用户原有日期目录保留，但不用于本次发布。
- 原生首轮已实际生成截图，但完整结果为 0/8，保留失败证据：`/var/folders/fp/rjn9tn6x6fxfq78fsvkvysxw0000gn/T/gundam-simulator-evidence-ehZiko/result.json`。后续按真实渲染类修正虚拟组件定位，并修复六机编队卡片按钮文字裁切；最终结果以上述独立提交完整复核为准。
- 云托管控制台访问被浏览器安全策略阻止，不能代为操作或换途径绕过；用户已确认稍后按 `UPGRADE_NOTES.md`、`README.md` 手动部署，之后继续公网拒绝与真实微信调用验收。
