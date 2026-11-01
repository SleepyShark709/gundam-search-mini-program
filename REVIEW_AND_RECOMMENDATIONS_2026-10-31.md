# 微信小程序检查、修改建议与实施记录

日期：2026-10-31（北京时间）  
项目：`/Users/shark/WeChatProjects/gundam-menu`  
范围：小程序移动端样式、页面与服务逻辑、性能、ESLint 与类型检查配置。

**实施状态：已按用户授权完成下列 13 项确认问题的代码修改，为心愿单、已购买两页追加加载动画、错误态和手动重试，修复状态图标切换占位、昵称头像读取恢复与持久缓存、系列列表数字布尔筛选，并将开发／真机调试默认连接改为现有云托管。126 项回归测试、三端类型检查、全仓 ESLint 均通过。** 一至五节保留修改前的审查证据与建议，前一批实施结果见第六节，最新样式复查见[第十三节](#十三已购买间距与主要页面样式复查)，2026-11-01目录更新及发布说明见[第十四节](#十四目录数据更新与发布准备)。真机软键盘验证与应用默认目录设置仍有待完成，不能视作已验证或已切换。

上一轮论坛屏蔽、购买表单和搜索框修复保持不变，详见[上一轮检查与修复记录](/Users/shark/WeChatProjects/gundam-menu/AUDIT_REPORT_2026-10-31.md)。本报告不使用 Web 项目的错误清单，也不将桌面网页及键盘导航问题纳入小程序整改。

## 结论与优先顺序

整理出 **13 项已确认的问题或工程缺口**，另有筛选面板在软键盘展开时的显示风险待真机验证。P1 优先防止保存结果误导用户；P2 处理功能、性能和检查基础；P3 改善可读性。诊断条数不等于独立缺陷数量。

建议按以下顺序分批修改：

| 顺序 | 修改内容 | 完成标准 |
|---|---|---|
| 第一批：数据与核心操作 | 购买失败反馈、清空购买字段、筛选入口避让胶囊 | 失败不报成功；清空后重进仍为空；筛选按钮完整可点 |
| 第二批：检查基础 | 分离三端类型检查、修复小程序类型诊断、建立 ESLint 基线 | 小程序/server/admin 可独立检查；真实 lint 命令可复现执行 |
| 第三批：性能与状态一致性 | 减少列表传输和组件数、初始化通知、收藏并发、详情串图、目录关联和超时处理 | 首屏不全量创建 934 张卡；慢网及并发下界面与实际记录一致 |
| 第四批：可读性与设备回归 | 提升详情辅助文字亮度、真机软键盘与短屏回归 | 低亮度可读；所有筛选字段及重置入口可达 |

## 一、样式检查

### S01 · P2 · 筛选按钮被微信原生胶囊覆盖

**状态：模拟器实测确认。** 390px 宽度下，筛选按钮为 x=337～374、y=51～88，原生胶囊为 x=296～383、y=51～83，重叠面积为 1184px²，约占按钮面积的 **86.5%**。系列页右上角看不到正常可用的筛选入口。

定位：[header.wxml](/Users/shark/WeChatProjects/gundam-menu/miniprogram/components/header/header.wxml:9)、[header.less](/Users/shark/WeChatProjects/gundam-menu/miniprogram/components/header/header.less:57)、[系列页启用筛选](/Users/shark/WeChatProjects/gundam-menu/miniprogram/pages/series/series.wxml:5)。[实测几何记录](/Users/shark/.codex/visualizations/2026/10/31/01a1924d-e298-7573-b561-6ffff75ee1cb/miniapp-review/header-geometry.json)。

建议：优先把筛选入口移到搜索栏附近；若继续放在顶栏，应根据 `wx.getMenuButtonBoundingClientRect()` 为胶囊保留区域。仅提高 z-index 不能解决原生胶囊占位。

验收：320、390、430px 下按钮完整显示并可点击，标题和按钮均不进入胶囊区域。

### S02 · P3 · 详情价格面板的辅助文字过暗

**状态：源码与颜色计算确认。** 价格标签、免税价格等使用 `#5a6380`，面板背景为 `#1a2340`，对比度约 **2.60:1**；相关字号为 24rpx，窄屏阅读较吃力。

定位：[颜色变量](/Users/shark/WeChatProjects/gundam-menu/miniprogram/styles/variables.less:20)、[详情价格样式](/Users/shark/WeChatProjects/gundam-menu/miniprogram/components/model-detail/model-detail.less:206)。

建议：先将价格面板内 `.price-label`、`.price-taxfree`、`.price-unknown` 调整为现有较亮的次要文字色，不必一次替换全局所有 muted 文字。

验收：低亮度真机上能直接读清价格含义和免税价格，主价格仍保持视觉重点。

### 需要验证后再决定是否修改

筛选面板自身没有受限高度或滚动区，额外留了 `200rpx` 顶部空白，所在 content 又隐藏溢出。短屏设备展开**手机软键盘**后，下半部分字段和重置入口有不可达风险。这是原生输入场景，尚未完成真机复现，不能当作已确认裁切。

定位：[filter-panel.less](/Users/shark/WeChatProjects/gundam-menu/miniprogram/components/filter-panel/filter-panel.less:10)、[筛选字段](/Users/shark/WeChatProjects/gundam-menu/miniprogram/components/filter-panel/filter-panel.wxml:13)、[系列内容容器](/Users/shark/WeChatProjects/gundam-menu/miniprogram/pages/series/series.less:11)。

验证方式：短屏真机依次聚焦四个范围输入框，确认后续字段及重置入口仍可访问；只有复现后，再减少顶部空白并增加受限高度的滚动区域。首页固定轮播尺寸可加入短屏回归，但本次不将未复现的情况列为缺陷。

## 二、功能与性能检查

### F01 · P1 · 购买保存失败仍提示“保存成功”

**状态：执行实际源函数的隔离复现确认。** 购买服务捕获异常并返回 `false`；系列页与心愿单页只等待 Promise，没有检查该返回值，因此仍关闭表单、标记已购买并提示成功。

复现对照：两个页面的新增、编辑共四条失败路径，服务返回 `false` 时全部得到“保存成功”、`formOpen=false`、`selectedIsPurchased=true`；对应四条 `true` 成功路径正常。

定位：[系列页提交](/Users/shark/WeChatProjects/gundam-menu/miniprogram/pages/series/series.ts:244)、[心愿单提交](/Users/shark/WeChatProjects/gundam-menu/miniprogram/pages/wishlist/wishlist.ts:122)、[购买服务返回值](/Users/shark/WeChatProjects/gundam-menu/miniprogram/utils/purchase-service.ts:48)。

建议：页面检查服务结果；失败时保留表单与原状态。另将“写入失败”和“写入成功但随后刷新失败”区分，避免后者误导用户重复新增。

验收：POST/PUT 失败只提示失败，表单不关闭；写入成功但列表刷新失败时仍准确表达已保存状态。

### F02 · P2 · 编辑购买信息时无法清空旧字段

**状态：实际表单函数隔离复现，加后端更新语义确认。** 清空价格、渠道、备注后，表单 payload 省略这三个字段；后端 PUT 只更新明确传入的字段，旧值继续保留。全部可编辑字段清空时，还可能形成无可更新字段的请求。

定位：[表单提交内容](/Users/shark/WeChatProjects/gundam-menu/miniprogram/components/purchase-form/purchase-form.ts:59)、[服务端 PUT](/Users/shark/WeChatProjects/gundam-menu/server/src/routes/purchases.ts:99)。

建议：利用现有后端可表达的 `null`，区分“保持不变”和“用户清空”，不再一律省略空字段。

验收：原本有价格、渠道、备注的记录被清空后，再打开仍为空；保留其他字段时不会误清。

### F03 · P2 · 大列表重复传输并全量创建组件

**状态：源码与开发工具运行提示确认。** HG 通贩有 934 项，实际出现单次 `setData` 约 **1188KB** 的提示。页面将完整目录、通贩、限定及处理结果反复传入视图，模板全量创建卡片；心愿单也把只用于逻辑筛选的全集放进页面 data。刷新 API 失败返回原缓存后，仍可能重复更新。

定位：[系列初始化](/Users/shark/WeChatProjects/gundam-menu/miniprogram/pages/series/series.ts:96)、[大数据更新](/Users/shark/WeChatProjects/gundam-menu/miniprogram/pages/series/series.ts:115)、[列表模板](/Users/shark/WeChatProjects/gundam-menu/miniprogram/pages/series/series.wxml:91)、[心愿单全集](/Users/shark/WeChatProjects/gundam-menu/miniprogram/pages/wishlist/wishlist.ts:28)、[刷新兜底](/Users/shark/WeChatProjects/gundam-menu/miniprogram/utils/model-service.ts:146)。

建议：先把纯逻辑使用的全集留在逻辑层，只向视图传必要字段和当前展示列表；首批渲染后按滚动追加，API 兜底返回同一份数据时跳过无效更新。先做这几步，再根据真机结果决定是否需要更复杂的虚拟列表。

验收：首次不创建全部 934 张卡片，不再出现当前 1188KB 单次传输提示；搜索、排序、总数和追加后的内容一致。

### F04 · P2 · 快速切换详情可能显示上一模型的图片

**状态：源码确认异步覆盖路径，延迟场景待运行复现。** A 的图片请求晚于 B 返回时，回调没有检查当前模型或请求编号，会把 A 的图集写入 B 的详情。

定位：[详情图片异步更新](/Users/shark/WeChatProjects/gundam-menu/miniprogram/components/model-detail/model-detail.ts:83)。

建议：返回时校验请求模型 ID 与当前模型 ID，关闭或切换后忽略旧结果。

验收：模拟 A 比 B 晚返回，B 始终显示自己的图片。

### F05 · P2 · 用户数据加载完成后，页面状态不一定同步

**状态：源码确认，慢网时序待运行复现。** 启动异步加载心愿单和购买记录，个人页计数及系列页状态却只读取当时缓存，没有完成通知；快速进入时可持续显示 0 或未收藏/未购买，直到再次进入页面。

定位：[启动加载](/Users/shark/WeChatProjects/gundam-menu/miniprogram/app.ts:19)、[个人页读取](/Users/shark/WeChatProjects/gundam-menu/miniprogram/pages/profile/profile.ts:30)、[系列页同步](/Users/shark/WeChatProjects/gundam-menu/miniprogram/pages/series/series.ts:120)。

建议：共享初始化 Promise，或在加载完成后通知相关页面同步；避免每页重复发起同一初始化。

验收：冷启动延迟三秒并立即进入“我的”或系列页，加载结束后计数和状态自动正确。

### F06 · P2 · 收藏失败与并发操作可能造成状态不一致

**状态：源码确认。** toggle 不检查增删结果就返回目标选中状态；删除失败恢复整份旧数组，可能覆盖请求期间对另一模型的成功修改，旧 GET 返回也可能覆盖乐观更新。

定位：[收藏服务](/Users/shark/WeChatProjects/gundam-menu/miniprogram/utils/cloud-favorites.ts:49)、[整缓存回滚](/Users/shark/WeChatProjects/gundam-menu/miniprogram/utils/cloud-favorites.ts:63)、[页面使用返回值](/Users/shark/WeChatProjects/gundam-menu/miniprogram/pages/series/series.ts:218)。

建议：区分操作成功与最终选中状态；按模型回滚，约束同模型连续操作，并防止旧读取覆盖新写入。无需为此引入新的状态管理框架。

验收：A 删除失败、B 添加成功时 B 保留；失败后卡片、详情和计数一致。

### F07 · P2 · 云端新模型可能在心愿单／已购中漏显

**状态：源码确认，需新模型记录验证。** 两页只在加载时取得本地目录快照，不主动刷新各系列；云端记录中的新模型若不在本地 JSON／缓存里，就会在关联时被静默过滤掉。

定位：[心愿单目录快照](/Users/shark/WeChatProjects/gundam-menu/miniprogram/pages/wishlist/wishlist.ts:28)、[关联过滤](/Users/shark/WeChatProjects/gundam-menu/miniprogram/pages/wishlist/wishlist.ts:55)、[已购关联](/Users/shark/WeChatProjects/gundam-menu/miniprogram/pages/purchased/purchased.ts:126)。

建议：目录刷新后重建记录关联；对于确实无法匹配的已有记录，保留可识别的占位，避免让记录无声消失。

验收：未打开过对应系列时，仅云端存在的新模型也能出现在两页，数量与记录一致。

### F08 · P2 · 请求超时与后端实际提交结果可能不一致

**状态：源码确认超时机制，延迟提交场景待运行复现。** 云端请求与五秒计时器做 `Promise.race`；超时拒绝不会取消后端写入。用户看到失败后重试，可能遇到已存在冲突；成功时计时器也未清理。

定位：[云端请求与计时器](/Users/shark/WeChatProjects/gundam-menu/miniprogram/utils/api.ts:68)、[新增购买冲突](/Users/shark/WeChatProjects/gundam-menu/server/src/routes/purchases.ts:67)。

建议：超时后先核对最终状态再允许重复写入，并在请求结束时清理计时器。

验收：服务器延迟六秒后提交时，页面最终能与服务器结果一致，不因立即重试产生误导。

## 三、ESLint 与类型检查

### E01 · P2 · ESLint 尚未建立检查基线

根目录、server、admin 均未发现 ESLint 配置、直接依赖或 lint 脚本，也没有现成 test 脚本／测试框架配置。**本项目的结论是“ESLint 未配置、未执行”，不是“ESLint 检查通过”，也不是“失败 7 项”。**

定位：[根 package.json](/Users/shark/WeChatProjects/gundam-menu/package.json:5)、[server package.json](/Users/shark/WeChatProjects/gundam-menu/server/package.json:6)、[admin package.json](/Users/shark/WeChatProjects/gundam-menu/admin/package.json:5)。

建议：补最小 ESLint 配置与脚本，按小程序和 Node 分配环境／全局变量，排除依赖、生成文件及第三方声明。先建立真实基线，再考虑更严格规则；WXML/Less 仍需独立编译和模拟器验证。配置方式参见 [ESLint 官方文档](https://eslint.org/docs/latest/use/configure/configuration-files)。

### E02 · P2 · 根 TypeScript 配置混入三端运行环境

根配置的 `include: ["./**/*.ts"]` 将小程序、server 和 admin 放到同一个编译上下文。实测全仓得到 **25 条诊断**；隔离小程序与本地 typings 后为 **17 条**，少掉 **8 条 Node／小程序全局重复声明**。不能将全仓 25 条直接算成 25 个小程序缺陷。

定位：[根 tsconfig](/Users/shark/WeChatProjects/gundam-menu/tsconfig.json:20)。

建议：小程序只覆盖 `miniprogram` 与对应 typings；server/admin 保留各自配置。在项目内固定 TypeScript 并建立三个独立的类型检查入口，避免借用另一个工作区的编译器。

验收：三端可以各自检查，Node 与小程序全局重复声明消失。

### E03 · P2 · 隔离后仍有 17 条小程序类型诊断

这些是 **16 条业务源文件诊断 + 1 条第三方声明诊断**，并非 17 个独立逻辑错误。详情组件中的定时器诊断可能存在连锁推断，应先修基础属性类型再复测。

| 分类 | 数量 | 代表位置与建议 |
|---|---:|---|
| `wx.getWindowInfo` 声明缺失 | 2 | [app.ts:6](/Users/shark/WeChatProjects/gundam-menu/miniprogram/app.ts:6)、[purchased.ts:359](/Users/shark/WeChatProjects/gundam-menu/miniprogram/pages/purchased/purchased.ts:359)；统一与基础库匹配的微信类型来源 |
| model 属性的 `value: null` 与声明不匹配 | 1 | [model-detail.ts:10](/Users/shark/WeChatProjects/gundam-menu/miniprogram/components/model-detail/model-detail.ts:10)；对齐属性定义与实例类型 |
| 详情定时器实例字段类型冲突 | 8 | [定义位置](/Users/shark/WeChatProjects/gundam-menu/miniprogram/components/model-detail/model-detail.ts:33)、[使用位置](/Users/shark/WeChatProjects/gundam-menu/miniprogram/components/model-detail/model-detail.ts:59)；修正组件实例推断，避免继续扩散 `any` |
| 未使用参数／变量 | 3 | [fallbackUrl](/Users/shark/WeChatProjects/gundam-menu/miniprogram/components/model-detail/model-detail.ts:97)、[收藏 cacheLoaded](/Users/shark/WeChatProjects/gundam-menu/miniprogram/utils/cloud-favorites.ts:4)、[购买 cacheLoaded](/Users/shark/WeChatProjects/gundam-menu/miniprogram/utils/purchase-service.ts:5) |
| Canvas 上下文类型缺失 | 1 | [purchased.ts:358](/Users/shark/WeChatProjects/gundam-menu/miniprogram/pages/purchased/purchased.ts:358)；使用实际小程序 Canvas 对应类型环境 |
| `wx.cloud.callContainer` 声明缺失 | 1 | [api.ts:74](/Users/shark/WeChatProjects/gundam-menu/miniprogram/utils/api.ts:74)；补齐或统一云托管 API 声明 |
| 第三方 `GetApp<T>` 泛型约束错误 | 1 | [wx.lib.wx.app.d.ts:265](/Users/shark/WeChatProjects/gundam-menu/typings/types/wx/lib.wx.app.d.ts:265)；随类型来源统一处理 |

当前 manifest 声明了 npm 微信 typings，但实际还通过本地 `typings` 引用另一套声明。建议先统一来源，不用全局关闭严格检查或开启忽略来掩盖诊断。

## 四、实际执行的检查与证据

| 检查 | 结果 | 范围／限制 |
|---|---|---|
| ESLint | 未配置，未执行 | 没有伪造 lint 错误数量 |
| 根 TypeScript `--noEmit` | 失败，25 条诊断 | 混合三端上下文 |
| 小程序隔离 TypeScript `--noEmit` | 失败，17 条诊断 | 临时配置保留严格程度，没有增加 skipLibCheck 或抑制诊断 |
| server `npm run build -- --noEmit --pretty false` | 通过 | 类型编译检查，未写构建产物 |
| admin 本地 tsc `--noEmit --pretty false -p tsconfig.json` | 通过 | 类型检查，不等同于完整打包或浏览器回归 |
| 购买提交／字段清空隔离复现 | 共 10 组对照 | 执行实际 TS 源函数，wx 与服务仅用内存 mock，无网络或数据库操作 |
| 筛选入口几何测量 | 确认与胶囊重叠 | 真实开发者工具，390px 视口 |

本轮使用的 TypeScript 均为 **5.9.3**。根与小程序借用了已有 Web 工作区中的编译器，因为此小程序尚无自己的可复现检查入口；没有安装依赖、改锁文件或调整配置。

证据文件：

- [根类型检查日志](/Users/shark/.codex/visualizations/2026/10/31/01a1924d-e298-7573-b561-6ffff75ee1cb/miniapp-review/root-tsc.log)、[小程序类型检查日志](/Users/shark/.codex/visualizations/2026/10/31/01a1924d-e298-7573-b561-6ffff75ee1cb/miniapp-review/miniprogram-tsc.log)、[隔离配置](/Users/shark/.codex/visualizations/2026/10/31/01a1924d-e298-7573-b561-6ffff75ee1cb/miniapp-review/tsconfig.miniprogram.json)。
- [server 类型检查日志](/Users/shark/.codex/visualizations/2026/10/31/01a1924d-e298-7573-b561-6ffff75ee1cb/miniapp-review/server-tsc.log)、[admin 类型检查日志](/Users/shark/.codex/visualizations/2026/10/31/01a1924d-e298-7573-b561-6ffff75ee1cb/miniapp-review/admin-tsc.log)。
- [购买问题复现脚本](/Users/shark/.codex/visualizations/2026/10/31/01a1924d-e298-7573-b561-6ffff75ee1cb/miniapp-review/repro-purchase.cjs)、[10 组输入与输出](/Users/shark/.codex/visualizations/2026/10/31/01a1924d-e298-7573-b561-6ffff75ee1cb/miniapp-review/repro-purchase-results.json)。

边界：函数隔离复现不等于完整端到端测试；现有本地 API 不可达、图片 503 是环境观察，不能据此认定线上故障。HG 静态价格字段实查为整数，开发工具中的属性警告根因尚未确认，不写成“价格数据都是字符串”。

## 五、默认项目目录设置

本次目标主目录应为：`/Users/shark/WeChatProjects/gundam-menu`。

当前可用项目工具没有修改主目录的接口；电脑操作工具明确拒绝控制 Codex 自身界面，因此**尚未自动完成应用内的默认目录切换**。本对话后续文件操作会显式使用上述小程序目录。

请在应用中完成：**当前项目菜单 → 编辑项目 → 添加文件夹 → 选择小程序目录 → 将该目录设为主目录**。官方说明指出，新聊天、默认 Git 操作和自动发现项目指令使用主目录；修改文件夹的设置步骤见 [OpenAI 官方项目文档](https://learn.chatgpt.com/docs/projects)。

审查阶段只新增此建议文档；后续用户授权实施的改动见下节。未提交 Git 或发布小程序。

## 六、实施与验证记录

实施日期：2026-10-31。所有代码、依赖和测试修改均在 `/Users/shark/WeChatProjects/gundam-menu`；未修改本地／云托管环境选择规则。

### 已落实的修改

| 编号 | 实施结果 | 主要位置 |
|---|---|---|
| S01 | 筛选入口移到搜索框右侧，删除 header 中不再使用的筛选属性与处理方法，避开微信胶囊 | `pages/series`、`components/header` |
| S02 | 详情价格辅助文字使用较亮的 secondary 颜色 | `components/model-detail/model-detail.less` |
| F01 | 系列、心愿单、已购页检查保存结果；失败提示失败并保留表单，成功后才关闭 | 三页的购买提交方法 |
| F02 | 价格、日期、渠道、备注清空时明确提交 null；保留价格 0；日期新增独立“清空日期”入口 | `components/purchase-form` |
| F03 | 系列与心愿单首批仅渲染 40 项，滚动追加；系列页完整目录和完整筛选结果留在逻辑层，限定组件只接收计数；切换筛选／排序重置首批 | `pages/series`、`pages/wishlist`、`components/limited-filter` |
| F04 | 图片异步结果校验请求编号、当前模型、打开状态与组件生命周期，阻止旧请求串图 | `components/model-detail/model-detail.ts` |
| F05 | 三种用户数据服务共用进行中的加载 Promise；页面等待加载后刷新列表、计数和详情状态 | 三种用户服务及相关页面 |
| F06 | 收藏按 ID 回滚、同 ID 操作串行；返回值区分操作成功与最终收藏状态；旧 GET 不覆盖成功写入 | `utils/cloud-favorites.ts` 及调用页面 |
| F07 | 心愿／已购关联不到模型时，只刷新缺失 ID 所属系列；仍缺失的记录保留占位和移除／编辑／删除入口，统计保留 | `utils/model-service.ts`、心愿／已购页 |
| F08 | GET 超时计时器在结束后清理；写请求等待微信 SDK 回调，不再被额外五秒计时器提前判失败；网络失败后读取服务端核对结果 | `utils/api.ts`、购买与收藏服务 |
| E01 | 建立 ESLint 推荐规则基线与锁定依赖，`npm run lint` 可复现执行；修复采集脚本的 prefer-const 诊断 | `eslint.config.mjs`、根 package 配置、采集脚本 |
| E02 | 根 TypeScript 仅检查小程序，server／admin 保留独立配置并提供统一检查入口 | 根及 server／admin package 配置、`tsconfig.json` |
| E03 | 微信类型统一到 npm 声明，旧 vendored 声明退出检查；修正模型属性、系列类型、Canvas 兼容声明和组件内部计时器类型；保留 strict，不启用 skipLibCheck | `typings/index.d.ts`、组件与页面类型 |

独立复核额外修正了冷启动 GET 与失败写入的交错问题：失败操作不再让服务随后丢弃原有购买记录、收藏或用户资料。三个服务按读取快照恢复，成功写入与网络核对后的结果仍受到保护；补了 GET 先返回／失败先返回，以及网络核对的回归测试。

上一轮论坛屏蔽与输入框裁切修复保留：底部只有“浏览／我的”，论坛页面不再注册；源码保留。心愿单双列使用项目中已有的内部网格留白方案，没有再次给 scroll-view 添加横向 padding。

### 自动检查结果

环境：Node.js **22.23.2**、TypeScript **5.9.3**、微信声明 **3.12.3**。根依赖已有 `package-lock.json`，server／admin 的 TypeScript 也锁定到相同版本。

| 命令 | 最终结果 | 覆盖范围 |
|---|---|---|
| `npm test` | **60 通过，0 失败，0 跳过** | 组件 8 项、系列与限定筛选 15 项、服务 21 项、用户页面与模型关联 16 项 |
| `npm run typecheck` | 通过，退出码 0 | 小程序、server、admin 三套严格类型检查 |
| `npm run lint` | 通过，退出码 0 | 全仓配置范围，0 error、0 warning |
| `git diff --check` | 通过 | 受跟踪文件差异的空白检查 |

测试执行真实 TS 模块的页面／组件／服务函数，隔离微信接口与网络，不访问真实数据库。覆盖保存 false／异常、字段清空、图片竞态、分页与筛选、冷启动加载、按 ID 回滚、同 ID 串行、缺失模型及超时核对。测试通过不等于已完成真机或后端端到端验收。

工具使用要求为 Node.js `^20.19.0 || ^22.13.0 || >=24`。当前系统默认 Node 18 不满足要求；本次使用已有的 `/Users/shark/.nvm/versions/node/v22.23.2/bin`，没有修改系统默认 Node。首次安装在根目录、server、admin 分别执行 `npm ci`，随后在根目录运行上述三条 npm 检查命令。相同说明已更新到 `CLAUDE.md`。

### 微信模拟器回归

使用原生微信开发者工具 Stable **2.01.2510280**、基础库 **2.32.3**。下面坐标为小程序逻辑像素，直接用微信 SelectorQuery 与胶囊 API 测量。

| 视口宽度 | 系列页第一排两张卡片横向范围 | 筛选按钮 top / 胶囊 bottom | 结果 |
|---|---|---|---|
| 320px | 10–158、162–310 | 64 / 56 | 两卡完整，按钮与胶囊分离 |
| 390px | 12–192、198–378 | 101 / 83 | 两卡完整，按钮与胶囊分离 |
| 430px | 13–212、218–417 | 114 / 90 | 两卡完整，按钮与胶囊分离 |

- HG 通贩总数仍为 934，初始 `processedModels.length` 为 40；调用加载下一批后为 80，最后一项 `hg-080`，总数保持 934。完整 1404 项系列目录不在页面 `data`。
- 390px 首屏页面 `data` 的 JSON 快照为 **17,590 个字符／18,538 UTF-8 字节（约 18.1 KiB）**。这是当前视图状态的序列化体积，不是累计 setData 传输量；此前进度中“约 17.6 KB”指字符长度，最终字节指标以这里为准。
- 320px 购买表单的输入框与备注横向范围均为 13–307；有日期时 picker 为 13–238，“清空日期”为 241–307。实际点击清空后显示“选填”，向下滚动可到达完整“保存”按钮。
- 320px 筛选面板四个范围字段及“重置筛选”在未弹出软键盘时均可见。
- 430px 心愿单使用四条仅写入页面内存的预览模型验证，第一排两卡范围为 13–212、218–417；未触碰真实收藏或购买写入，检查后恢复真实列表。
- 设备已恢复 iPhone 12/13 (Pro)，390px；临时表单与预览记录未保存。

### 验证边界与后续建议

1. 本地 API `192.168.31.212` 在当前机器不可达，控制台仍有请求失败；部分图片返回 503。这些环境现象保留原状，未据此切换云环境或修改真实数据。保存、删除、网络核对的正确性目前由隔离回归覆盖，待本地服务可达后再做端到端验收。
2. 短屏真机弹出微信软键盘时，筛选字段／重置入口是否可达仍待验证；不把模拟器的无键盘检查写成真机已通过。尚未复现首页轮播裁切，因此没有推测性改布局。
3. 写请求网络失败且随后核对 GET 也失败时，客户端仍无法判定服务端是否已提交；当前返回失败并保留输入。彻底消除这种不确定性需要服务端幂等约定，未在本轮擅自扩展接口。
4. ESLint 为真实推荐规则基线，沿用项目的 any 边界等现有约定；“检查通过”不代表已经消除所有 any 或完成整体架构重构。
5. 应用内默认项目目录仍按第五节手动设置；本轮操作全部明确指向小程序项目。代码和文档尚未 Git 提交，也未上传或发布。

## 七、心愿单加载动画、错误态与重试

### 问题与修复

用户反馈线上心愿单偶尔为空，再次进入恢复。进一步隔离执行实际代码，复现了“首次请求失败／五秒超时 → 空缓存被显示成暂无收藏 → 再进入请求成功才出现记录”的链路。上一批修复了加载时序，但没有区分读取失败和成功空记录；本轮补齐这个遗漏。具体线上失败原因仍需服务端日志确认。

- `loadWishlist()` 现在返回成功与否，保留共享请求、缓存及读写并发保护，不向其他页面抛出未处理异常。
- 页面用 `loading` 与 `loadError` 分开处理加载、错误、成功空列表及有记录四种状态。
- 首次读取时显示高达加载动画；读取失败显示“心愿单加载失败”和“点击重试”。只有成功读到空列表才显示“还没有心愿单中的模型”。
- 有缓存时继续显示卡片，更新中显示轻量提示；更新失败保留列表，并提供重试按钮。
- 页面显示与手动重试共用加载函数；合并重复点击，卸载后忽略迟到响应；不增加人为等待时间，不改现有 GET 超时设置或偷偷切换云环境。

主要文件：`miniprogram/utils/cloud-favorites.ts`、`miniprogram/pages/wishlist/wishlist.ts/.wxml/.less`、`tests/services.test.cjs`、`tests/user-pages.test.cjs`。

### 简笔图与动画设计

按用户最新要求，最终采用极简高达头盔线稿，仅保留白色轮廓、V 形天线及青色眼睛。详细 3D 版本与透明边缘不干净的中间版本未加入项目。

- 生成方式：内置 `image_gen` 工具，未使用 CLI 或另外调用模型 API；工具接口没有模型选择参数。
- 项目素材：[gundam-loading.png](/Users/shark/WeChatProjects/gundam-menu/miniprogram/assets/gundam-loading.png)，256 × 256 PNG，约 65 KiB；生成原图保留于 Codex generated_images 目录，项目使用小尺寸版本。
- 运行时不下载远端加载图。加载动效由原生小程序 WXSS 实现：头像以 2.4 秒周期上下浮动，青色扫描线以 1.8 秒周期从上往下移动，三点以 1.2 秒周期依次闪动。有缓存时的更新提示使用小尺寸旋转指示器。
- 错误态展示静止线稿和重试按钮，避免错误页面持续播放加载动画。

最终选用图片的生成提示词：

```text
Use case: stylized-concept
Create a tiny, extremely minimalist loading icon for a Gundam model collection app. A flat 2D white line drawing of a Gundam helmet seen straight from the front: one simple angular helmet outline, a simple iconic V antenna made of two straight strokes, two short cyan eyes, one small chin shape. Just 6 to 10 simple clean geometric strokes, approximately 16px monoline weight. Very few details, friendly simple doodle, no complex face panels, no inner antenna outlines, no vents. Center the head within the central 60 percent of a square canvas with ample blank space. Use ONLY solid dark navy #0a0e17 as the fully opaque background, near white #e8edf7 as the outline, and cyan #00d4ff as the eyes. Clean anti-aliased solid white strokes that remain fully visible. Absolutely no transparency, no alpha mask, no texture, no speckles, no noise, no shading, no 3D, no gradients, no glow, no ring, no words, no UI. The result must look like a minimal app icon or concise 简笔画, readable at 80 pixels. The app will add actual animation separately. Square image.
```

### 本轮验证

- 自动回归从 60 项增至 **68 项，全部通过**；新增覆盖真实服务与页面链路的断网、五秒超时、失败后重试成功、成功空记录、缓存失败保留、重复重试合并及卸载后迟到响应。
- `npm run typecheck`（小程序／server／admin）和 `npm run lint` 均通过。
- 390px 微信模拟器实测首次失败显示重试入口；实际点击“点击重试”触发新请求，本地 API 仍不可达时保留错误提示，没有显示暂无收藏。
- 使用仅修改页面内存的加载预览，微信 SelectorQuery 采样证实动画实际运行：头像 transform 从 y=0 变为约 -3.21px，扫描线从 y=0 变为约 23.26px，opacity 从 0 变为 0.85。预览后恢复真实失败状态。
- 成功返回及失败后成功由隔离测试覆盖；尚未对真实线上账户做写入，也未上传或发布小程序。

2026-11-01 补完锁屏中断的 320px 窄屏回归：加载插画、标题、副文案与闪动点均完整可见（整体位于 y=223–403）；错误态“点击重试”按钮范围为 x=68–252、y=376–410，实际点击可再次发起请求。本地接口仍不可达时继续保留错误提示，没有显示暂无收藏。动画两帧中头像 y 从约 0 变为 -2.48px，扫描线 y 从约 0 变为 18.13px、opacity 升至 0.85；微信实际读取的素材尺寸为 256 × 256。临时加载预览已恢复，检查后恢复常用 390px 设备。

## 八、已购买加载与重试、共享表单复核

日期：2026-11-01。此前新增动画与重试仅覆盖心愿单，本轮已补齐已购买页。

### 实施内容

- 已购买页复用同一高达素材、浮动／扫描／闪点动画，增加首次加载失败提示与“点击重试”。成功读取到空记录才显示暂无已购买。
- 购买服务返回明确读取结果，保留原有缓存、共享请求与按 ID 保护；收藏请求失败不会被误判为购买加载失败。
- 有缓存时继续展示购买卡片与统计，更新失败后保留，显示带重试按钮的提示横条；重复重试合并，页面卸载后忽略迟到响应。
- 两页公共加载样式提取到 `miniprogram/styles/load-state.less`，避免重复维护。320px 原生回归发现内联“重试”受到微信默认大按钮宽度影响，已在两页采用 mini 按钮并明确自动宽度／最小宽度；实测宽度从 184px 收紧为 56px，提示文案可完整单行显示。

相关生产文件为 `utils/purchase-service.ts`、`pages/purchased/purchased.ts/.wxml/.less`、`pages/wishlist/wishlist.less/.wxml` 及公共样式。本轮没有修改共享购买表单源码，表单为重新检查既有修复。

### 共享购买表单验证

静态复核三个入口（系列／心愿单／已购买）的参数传递、零价格、null 清空、日期清空、盒模型与安全区留白，未发现确定缺陷。原生模拟器从已购买页打开共享表单，使用重复三次的长模型名、价格 0、已有日期及 **500 字备注** 检查：

| 设备宽度 | 输入框与备注横向范围 | 滚动后保存按钮范围 | 结果 |
|---|---|---|---|
| 320px | x=13–307 | x=13–307，y=515–555 | 标题正常换行，控件无横向裁切，完整保存按钮可达 |
| 390px | x=16–374 | x=16–374，y=745–794 | 标题正常换行，控件无横向裁切，完整保存按钮可达 |

320px 日期 picker 范围 x=13–238，清空按钮 x=241–307；390px 实际点击“清空日期”后显示“选填”。长备注在固定高度文本区内展示并可滚动，外层表单也可继续滚动到底。未点击保存或删除；预览内容只存在于页面内存，检查后已恢复。

### 检查结果与边界

- **77/77 测试通过**：在原 68 项基础上新增 9 项购买读取与页面回归，覆盖失败／成功空记录／缓存保持、真实云请求的断网与五秒超时后重试恢复、重复请求合并、统计保留、卸载后迟到结果及收藏失败隔离。
- 全项目 `npm run typecheck`（小程序／server／admin）与 `npm run lint` 通过，`git diff --check` 通过。
- 390px 已购买页实际点击重试可再次请求；加载动画两帧中头像 y 从 0 变为约 -3.32px，扫描线 y 从 0 变为约 24.34px、opacity 升至 0.85。320px 错误页重试按钮完整位于 x=68–252、y=376–410。
- 320px 缓存卡片与提示横条同时显示，卡片范围 x=13–307；重试按钮修复后位于 x=244–300，提示文字占 218px 宽，未再被默认大按钮挤压。
- 上述结论只覆盖静态检查与模拟器已执行场景；真机弹出软键盘后的表现尚未验证，不能据此承诺所有设备完全没有异常。本地服务仍不可达，线上端到端读取恢复仍需有可用服务时验证。代码尚未提交或发布。

## 九、昵称头像持久化与读取恢复

日期：2026-11-01。用户反馈设置好的昵称和头像过一段时间消失。

### 已确认根因

原客户端只把资料保存在当前进程内存中。微信回收进程后，首次资料 GET 如果失败，服务层和 App 仍把资料标记为“已加载”；个人页随后不再读取，并把空缓存显示成未设置资料。隔离执行实际 TypeScript 代码复现：首次失败后，即使网络恢复，连续两次进入个人页也没有再次请求；主动重读后原资料恢复。

昵称和头像引用仍通过 `/api/user/profile` 存入 MySQL，头像文件仍由 `wx.cloud.uploadFile` 存入云存储。未发现定时删除资料或将 chooseAvatar 临时路径直接存库的代码；本次没有连接线上数据库，因此不把客户端显示为空解释成数据库资料已删除，也未确认线上首读失败的具体原因。

### 修复内容

- `loadUserInfo()` 返回本次远端读取是否成功；失败不再标记为成功。个人页每次进入均可重新同步，合并并发请求，并提供失败提示和“重试”入口。
- 增加微信本地持久缓存，键为 `gundam-user-profile:v1:<appId>:<envVersion>`，隔离不同小程序与开发／体验／正式版本。仅缓存服务端成功确认的 OpenID、昵称及 `cloud://` 头像引用，不缓存临时头像、失败保存值或管理员权限；没有按时间自动过期的逻辑。
- App 启动恢复最近确认资料；读取失败保留缓存，成功返回空资料时清除旧资料，远端确认不同 OpenID 时替换旧身份资料。本地缓存只用于资料展示，权限仍需远端确认；系统或用户清理本地存储后，仍须联网读取。
- 分开处理加载中、读取失败、真正未设置及部分资料。已有缓存时失败继续展示；只有昵称或只有头像时允许补全，不因缺一个字段丢弃另一个。
- 保留原有 GET／POST 并发保护，旧请求不能覆盖新保存。保存失败保留草稿，不提示成功、不污染持久缓存；Storage 读写异常也不影响远端成功结果。
- 独立复核发现并修正两项页面竞态：迟到 GET 不再覆盖正在填写或主动清空的昵称／头像；并发 GET 成功、POST 失败后，页面与 App 会重新采用服务层已确认资料，同时保留未提交草稿。成功保存才结束草稿状态；页面卸载后不再更新视图。

生产文件：[user-service.ts](/Users/shark/WeChatProjects/gundam-menu/miniprogram/utils/user-service.ts)、[app.ts](/Users/shark/WeChatProjects/gundam-menu/miniprogram/app.ts)、[profile.ts](/Users/shark/WeChatProjects/gundam-menu/miniprogram/pages/profile/profile.ts)、同目录 `profile.wxml/.less`。

### 验证与边界

- 新增 [profile-persistence.test.cjs](/Users/shark/WeChatProjects/gundam-menu/tests/profile-persistence.test.cjs) 共 **24 项真实 TS 链路回归**，覆盖模块重建恢复、首次断网后重入／重试、成功空资料、不同身份、开发环境隔离、Storage 异常、失败保存、旧 GET 竞态、部分资料、卸载迟到结果及草稿保护。API、数据库和 Storage 使用隔离替身，没有写入真实账号。
- **全量 101/101 测试通过**，小程序／server／admin 类型检查及 ESLint 零警告通过；独立复核重跑本轮 24 项测试，未发现剩余阻塞问题。
- 390px 原生微信模拟器确认：当前本地 API 不可达时显示“资料暂时加载失败／请检查网络后重试”，实际点击“重试”再次发起 `/api/user/profile` GET，失败后仍保留重试入口。
- 本轮没有修改服务端、数据库或云存储配置，没有保存测试昵称／头像，也未上传发布。持久缓存保存头像引用，图片本身的联网加载和云文件是否存在仍由微信云存储决定；不承诺离线时一定能下载头像。线上完整恢复需发布新版本后验证。

## 十、开发与真机调试默认连接修复

日期：2026-11-01。用户反馈控制台大量报错，真机调试接口全部 failed，昵称头像持续提示同步异常。

- 微信开发者工具当前控制台确认：收藏、购买、资料、系列接口均请求写死的 `http://192.168.31.212`，报 `ERR_ADDRESS_UNREACHABLE`。业务层再输出同一失败的错误日志，形成多条红字；黄色关闭合法域名／TLS 校验提示与此不同。
- 原环境分流将 `develop`（包含开发工具和真机调试）默认连接本地地址，并使用 `local-dev-user`。由于尚未读取手机端实际请求日志，不能把手机所有失败直接认定为已现场复现同一原因；该默认分流已确认与用户当前使用云托管的意图不符。
- 最小修复：将 `miniprogram/utils/api.ts` 已有 `FORCE_USE_CLOUD` 默认设为 `true`，保留原云环境和服务名、超时及业务逻辑。开发工具和真机调试默认走原有云托管；明确需要本地联调时可手动设为 `false`，体验／正式版仍走云。
- 新增 `tests/api-routing.test.cjs` 共5项真实 TS 回归，覆盖三种版本的云调用且不携带本地模拟身份、GET 超时清理，以及真实用户资料写入与旧读取的并发保护。全量 **106/106 测试**、三端 typecheck、ESLint 零警告及差异空白检查通过。
- 用户需要重新编译并重新开启真机调试；此次尚未验证手机上的云请求实际成功，也未保存测试昵称／头像或发布小程序。
- 用户授权查看云账单，但账单页自动访问被工具安全限制阻止，未取得账单明细。不能将用户所述约50元消耗直接归因于图片流量，费用构成仍待核对。

## 十一、加载结束时图标尺寸和位置跳变

日期：2026-11-01。用户反馈 loading 与结束后的图标尺寸不一致。源码确认心愿单／已购买两页同一张高达图在加载态为240×240rpx，在失败态为200×200rpx；底部间距也从32rpx变为24rpx。加载圆点和重试按钮高度不同，使整组居中内容随状态切换上下移动；空列表另用一套无固定图框的布局。

本轮仅修改公共加载样式及两列表页的 WXML／Less，共5个文件：

- 三态统一240×240rpx图框及32rpx图框底部间距；失败态高达不再缩小，空列表的♡／✓保留原字号并放入相同图框。
- 标题／副标题行框分别固定48／36rpx；加载圆点、重试按钮和“去探索”均位于80rpx动作区，动作区上距32rpx。三态内容占位高度均为516rpx，使状态变化不再改变图框和文字的居中基准。
- 保留高达浮动、扫描和闪点动画；失败态图片静止。未修改业务逻辑、个人页或素材，个人页的重试按钮样式通过作用域隔离保持原状。
- 现有106项测试、三端类型检查、ESLint及差异空白检查均通过。纯样式修改未新增镜像单元测试；仓库没有独立可调用的Less编译器，未安装新依赖。
- 用户解锁后已完成原生模拟器两页三态矩形对比。390px下图框均为124×124px、位置x=133/y=337，标题／副标题／动作区顶部均为485／517／559px；320px下图框均为102×102px、位置x=109/y=205.5，标题／副标题／动作区顶部均为326.5／352.5／386.5px。三态的宽高及垂直基准一致，重试按钮均完整可见。原生工具完成相关WXML／Less编译；浮动动画只作用于加载图内部，不改变占位框。
- 对比使用页面内存预览，检查后恢复原状态；设备已恢复390px，未改动或保存真实用户记录。重新编译后模拟器已能读取云端购买数据；另观察到渲染层 `this._getData is not a function` 错误，尚未定位，未在本轮图标布局修复中修改无关图表或渲染代码。

## 十二、HG等系列tab有数量但列表为空

日期：2026-11-01。用户反馈本地调试进入HG时，通贩／限定tab有数量，但模型列表为空。

已确认根因：数据库的 `is_limited` 为 `TINYINT(1)`，API仅转换键名，数值0／1被原样写入客户端缓存。系列页统计使用真假判断，数量正常；列表却以 `model.isLimited === false/true` 严格比较，数字与布尔不相等，导致所有记录被过滤。实际TS隔离执行复现了本地布尔JSON正常、API数字数据刷新后结果为0的完整页面行为。

- 最小修复：[series.ts](/Users/shark/WeChatProjects/gundam-menu/miniprogram/pages/series/series.ts:327)先对 `isLimited` 做布尔判断，再与当前tab比较，与统计规则一致。所有系列共用这一页面；兼容布尔、数字及混合缓存，不需要清除微信Storage、不改收藏或购买记录，也不需要重新部署后端。
- 新增3项 [页面回归](/Users/shark/WeChatProjects/gundam-menu/tests/pages.test.cjs:137)，覆盖数字0／1、混合类型，以及真实服务端键名转换后刷新到页面的链路；同时检查tab数量、限定子筛选、首批40条及后续分页。三个测试在修复前均失败，修复后通过；全量 **109/109** 测试、三端typecheck、ESLint零警告通过。
- 390px原生模拟器验证：当前HG目录共1404项，实际首项 `isLimited` 为数字0。通贩tab显示934项、`resultCount=934`、首批40张卡片实际可见；切换限定tab显示470项、`resultCount=470`、首批40张卡片实际可见。没有通过setData伪造目录、没有修改真实用户记录。
- 验证时仍观察到既有价格组件接收非Number值的警告，以及渲染层 `undefined is not iterable` 错误；未定位为本次列表筛选问题，相关卡片最终正常显示。本轮未扩大修改价格或渲染层代码，也不把此处验证表述为控制台已无其他问题。

## 十三、已购买间距与主要页面样式复查

日期：2026-11-01。按用户要求使用 [frontend-design 技能](/Users/shark/.codex/skills/frontend-design/SKILL.md) 复查样式，沿用既有深色、青色高亮机甲风格，不更换字体或整体主题。静态检查覆盖首页、系列、心愿单、已购买、个人页及卡片、详情、购买表单、搜索、分类筛选等共享组件；仅修复有具体证据的局部问题。

| 项目 | 已实施调整 | 涉及文件 |
|---|---|---|
| 展开评分内容与“原价折合”贴连 | 展开面板增加32rpx底部外边距 | `pages/purchased/purchased.less` |
| 长备注与“编辑”重叠 | 备注和编辑放入流内底栏，备注可收缩省略，编辑保持完整 | `pages/purchased/purchased.wxml/.less` |
| 价格与长渠道超出购买卡片 | 价格不收缩，渠道文本局部省略，不依赖跨组件样式穿透 | 同上 |
| 连续英文昵称超出个人页 | 限制昵称最大宽度，允许断词，保持居中 | `pages/profile/profile.less` |
| 系列骨架卡片边框贴连 | 外层负责列宽和6rpx留白，内层负责卡片边框与背景 | `pages/series/series.wxml` |
| 辅助小字号文案过暗 | muted从`#5a6380`提亮为`#808ba8`，保持低于secondary的层级 | `styles/variables.less` |
| 搜索框组件盒模型未自足 | wrapper明确border-box，边框计入100%宽度和80rpx高度 | `components/search-bar/search-bar.less` |

对比度计算：在secondary背景`#141b2d`上由2.88提升至5.04；在tertiary背景`#1a2340`上由2.60提升至4.55。装饰性空态图标、disabled透明度和选中强调色保留原有机制。

### 验证记录

- 现有 **109/109测试**、小程序／server／admin类型检查、ESLint零警告均通过。纯样式修改未增加镜像单元测试。
- 390px原生模拟器：系列骨架首排卡片范围x=12–192、198–378，间隙6px，边框不再相接。预览后恢复真实列表。
- 390px已购买页：展开面板底部y=764、对比区顶部y=780，间隔16px。使用仅页面内存的长内容预览，价格`99,999.99`完整位于x=112–196.30；渠道文本x=209.30–356且有省略号；备注至x=333、编辑从x=341开始，间隔8px，无覆盖。已恢复原购买列表，未保存预览值。
- 320px、长昵称与共享表单的本轮复查尚待完成；Mac再次锁屏，已请求用户手动解锁，不把未执行场景记为通过。

### 雷达画布显示异常

滚动复查时观察到雷达图像素浮在购买卡片之上，同时出现渲染层 `this._getData is not a function`。只读检查及真实绘图函数的隔离调用没有发现越界坐标、重复scale累积或卸载后绘图；画布和容器均为400rpx正常文档流尺寸。现阶段只可判断为画布滚动定位／裁剪异常候选，不能断言特定基础库版本缺陷，也尚未将其计为已修复。待解锁后对照滚动前后的DOM矩形、像素位置及节点尺寸，再决定是否需要局部裁剪样式修复。

## 十四、目录数据更新与发布准备

日期：2026-11-01。数据源为万代官网 HG／RG／MG／PG 品牌列表，包含列表指向 Premium Bandai 的商品。本次完整扫描227页，补充原目录遗漏与官网已公布的新款／预定款；不把预定月份当作已上市。

| 系列 | 更新前 | 新增 | 更新后 | 已有商品官方改价 |
|---|---:|---:|---:|---:|
| HG | 1404 | 33 | 1437 | 128 |
| RG | 176 | 9 | 185 | 23 |
| MG | 565 | 6 | 571 | 67 |
| PG | 52 | 2 | 54 | 2 |
| 合计 | 2197 | 50 | 2247 | 220 |

### 实施与校验

- 保留全部2197个旧ID及其他非价格字段，未删除旧模型、未改中文名／日期／限定属性／已有图片路径；50个新增条目暂用官方日文名。新增ID和官网URL无重复，大小写及间隔点差异的同名检查未发现重复候选，价格与年月格式校验通过。
- 价格使用官网当前日元含税标价，220条均为上涨；税前值沿用既有除以1.1的推算规则。这里没有加入市场实时价格、往年行情或机体介绍。后续市场价口径已由用户确定，见第十五节；外部数据源尚未接入。
- 新增50张首图下载为 JPEG，使用稳定 `/images/{id}/cover.jpg` 路径；全部可解码且尺寸有效，已记录SHA-256，并抽查RG新图与商品对应。同步写入 `series-meta.json` 与实际打包的 `series-meta.js`，四系列统计与目录一致。
- 修正抓取脚本的全量提前退出、P-Bandai漏解析、实体解码、跨页及首屏URL重复、完整标题唯一回退、同商品旧页面覆盖新价等问题。新增 `--update-prices` 保留发售日期；`--download-images` 下载前按源页刷新临时签名，同页复用刷新结果。实测发现部分签名约数分钟过期，因此未直接保存签名URL。
- 页面失败、空解析、图片校验失败均报错，不把失败当无更新；默认本地命令不连接数据库。`.dockerignore` 增加排除 `.env`，本次后端包以明确文件列表生成，不包含本机环境变量或依赖目录。
- 新增17项抓取回归，全套 **126/126** 测试、三端typecheck、ESLint零警告及 `git diff --check` 通过。发布SQL只读复核通过；价格验收使用MySQL空值安全比较，能报告线上NULL导致的跳过。未连接真实数据库执行SQL，未把静态复核表述为线上导入成功。

### 发布交付物

- [详细发布步骤](/Users/shark/WeChatProjects/gundam-menu/README.md)：后端完整图片包 → MySQL目录增量 → 云端验证 → 小程序上传／体验／审核／发布；说明80端口、现有服务、挂载图片目录、缓存及回退方式。
- [本次目录导入SQL](/Users/shark/WeChatProjects/gundam-menu/server/data-updates/2026-11-01/apply.sql)：含ID／URL冲突预检；只新增目录、按旧值guard更新价格、按数据库实际数量更新统计。重复执行不覆盖旧名称／日期／图片，不触及用户及多图表。
- [价格回退SQL](/Users/shark/WeChatProjects/gundam-menu/server/data-updates/2026-11-01/rollback-prices.sql)：只恢复仍等于本批新值的官方价格，保留新增模型及可能产生的收藏关联。
- [变更清单](/Users/shark/WeChatProjects/gundam-menu/server/data-updates/2026-11-01/manifest.json)：50条新增、220条价格前后值、各系列计数及新图SHA-256。
- 后端上传包：`/Users/shark/WeChatProjects/gundam-menu-release-2026-11-01/gundam-server-2026-11-01.zip`，172,548,645字节，2840个文件，压缩包CRC校验通过，含全部产品图片。SHA-256：`1782ff18a6d43de6389e03f4995631e39d7b89759eedff2c6209733a4c8ed05f`。

**当前状态：本地目录、首图、SQL及上传包已准备完成；线上MySQL、云托管服务和小程序正式版尚未更新。** 本轮未执行生产数据库操作或完成线上验收。线上应用SQL后，已有正式版可异步取得目录；此次其他前端修复及本地兜底更新仍需单独上传审核发布。

## 十五、市场价格与历年参考价的确认口径

**当前状态（2026-11-01）：用户决定暂不推进市场价及往年行情。第十五、十六节仅留作备查，不属于当前实施任务；无需申请电商接口账号或购买数据服务。现有官方参考价及已完成的目录更新保留。**

日期：2026-11-01。用户确认：**国内与日本分别展示市场价格；往年显示各年的市场参考价，用于辅助判断入手价高低。** 本节是待接入方案，尚未增加市场价格接口或页面，也没有将上一节官方标价更新视为行情数据。

### 展示与对比

- 国内使用人民币、日本使用日元；保留独立的官方参考价。每份市场报价注明平台／渠道、观察时间、新旧成色、现货或预售，以及税费、运费和优惠条件。第一版建议以未组装新品现货为口径，二手、预售、定金及配件单卖分别识别。
- 同一模型、比例、版本及套装先匹配平台商品ID／JAN／ASIN；搜索结果须核对后绑定，不能直接采用搜索首项。目前目录只有万代／P-Bandai链接，缺少这些电商标识。
- 历年参考建议按已获授权的历史样本计算年度中位数与区间，并显示来源、样本数量及覆盖时间。有可靠记录的年份才展示，缺失年份显示“暂无数据”；零散记录不能标为完整全年行情，也不把挂牌价写成成交价。
- 个人入手价优先与同款、同地区、同币种、同条件且接近购买日期的参考价比较；年度统计用于年度回顾。当前购买记录使用人民币，日本日元历史仅作原币参考；跨币种对比需要购买时期的历史汇率，不能使用当前汇率判断往年贵贱。个人购买记录只用于该用户自己的比较。

### 已核实的数据来源及限制

| 地区／来源 | 当前报价 | 历史能力与待办 |
|---|---|---|
| 国内：淘宝联盟 | 物料搜索有人民币预估到手价；需入驻、媒体备案、应用及推广位，部分比价用途需要相应场景权限 | 该搜索接口没有往年行情序列；实际权限和商品覆盖需账号验证 |
| 国内：京东联盟 | 商品查询可返回商品价、促销价、券后价，需申请接口权限及获批场景 | `historyPriceDay` 是达到多少天内最低的标识，不是历史曲线；不能由此生成往年各年价格 |
| 国内：慢慢买商务合作 | 官方介绍提供比价API及企业数据合作 | 未核实到公开商务API字段、报价、高达覆盖量、年限及公开展示授权，须取得样例和合作条款再评估 |
| 日本：Yahoo! Shopping | 官方搜索v3支持日元价格、JAN、库存、成色；需申请Client ID | 未提供历史价格查询；展示及留存应按平台许可核实 |
| 日本：Rakuten | 官方搜索提供当前售价及库存；当前版本需applicationId及accessKey | 官方规定价格及可售性只缓存24小时，不能默认将其永久快照积累为历史库 |
| 日本：Keepa | 付费API提供Amazon.co.jp报价历史，需订阅及SKU→ASIN映射 | 仅从每个商品实际跟踪时间起有数据，未验证2247款覆盖率、实际套餐费用及公开小程序展示许可；不能当作整个日本市场成交历史 |

官方依据：[淘宝接口](https://developer.alibaba.com/docs/api.htm?apiId=64759)、[淘宝接入指南](https://developer.alibaba.com/docs/doc.htm?articleId=118970&docType=1&treeId=713)、[京东商品查询](https://jos.jd.com/apilist?apiGroupId=461&apiId=15153&apiName=jd.union.open.goods.query)、[慢慢买官方介绍](https://help.manmanbuy.com/)、[Yahoo搜索v3](https://developer.yahoo.co.jp/webapi/shopping/v3/itemsearch.html)、[Rakuten搜索](https://webservice.rakuten.co.jp/documentation/ichiba-item-search)、[Rakuten缓存规则](https://webservice.faq.rakuten.net/hc/ja/articles/900001974343)、[Keepa历史对象](https://keepa.com/api-docs/product-object.html)、[Keepa计费模型](https://keepa.com/api-docs/plans-tokens.html)。本轮未注册、购买服务或使用真实API凭据验证命中率。

Keepa文档还有历史口径变化：NEW等部分序列在2026-02-23前为最低挂牌价，此后为含运费的最低到手价。接入时应保留口径并分段，不能直接混算年度均值。

### 下一步与当前依赖

用户此前确认没有API账号或历史报价数据，接入方案已整理在第十六节；现已决定暂不实施，不再继续接口申请或数据源评估。当前未接入外部市场价格；现有官方价格、购买记录及已准备的发布包保持本轮交付状态。

## 十六、无现有账号时的价格数据接入方案（暂不实施）

**本节仅供未来重新评估时参考，以下申请、开发和验收步骤均不属于当前待办。**

日期：2026-11-01。面向当前微信小程序及其Express／MySQL后端。**推荐先验证20款的国内、日本当前报价，再决定历史数据采购和全目录扩展。数据采购预算先以0元为目标；付费历史服务先取得样例与正式报价。** 这是一份执行方案，尚未申请账号、购买数据、创建采集任务或修改行情功能代码。

### 1. 推荐来源与申请顺序

| 用途 | 首选与申请入口 | 本阶段要取得的结果 |
|---|---|---|
| 国内当前报价 | [淘宝联盟接入指南](https://developer.alibaba.com/docs/doc.htm?articleId=118970&docType=1&treeId=713)，申请[物料搜索升级版](https://developer.alibaba.com/docs/api.htm?apiId=64759) | 完成入驻及适用的媒体备案，取得应用AppKey／Secret、推广位adzone_id；核实商品查询、消费者比价及小程序展示用途的实际权限 |
| 日本当前报价 | [Rakuten Web Service应用注册指南](https://webservice.rakuten.co.jp/guide) | 注册Rakuten账号及应用，取得applicationId和accessKey，确认应用用途、允许的访问来源及署名要求 |
| 国内往年报价 | [慢慢买官方商务合作入口](https://help.manmanbuy.com/) | 询问高达样本历史、覆盖月份、报价口径、展示／保存范围和正式费用；先验证能否提供合适数据 |
| 日本往年报价 | [Keepa API及订阅说明](https://keepa.com/api-docs/plans-tokens.html) | 核实Amazon.co.jp样本ASIN的历史覆盖、公开小程序使用范围、保存许可及最低适用套餐，不先订阅 |

选择理由：淘宝接口公开标注免费，但仍需应用凭据、推广位和实际权限；数值商品链接及特定精确搜索涉及比价场景权限。日本先评估Rakuten，是为了避免把Yahoo账号申请当成默认可行入口：Yahoo新账号使用手机短信注册，官方说明海外手机号不能用于该短信验证。[淘宝权限与字段](https://developer.alibaba.com/docs/api.htm?apiId=64759)、[Yahoo注册](https://support.yahoo-net.jp/PccLogin/s/article/H000010762)、[Yahoo短信限制](https://support.yahoo-net.jp/SccLogin/s/article/H000012420)

申请成功与否、所需资质及用途许可，以平台当前审核为准。申请不适用于本小程序或样本覆盖不足时，国内再评估京东联盟，或取得商家授权报价；日本当前报价可评估其他已获许可来源。某地区尚无来源时显示“暂无数据”，不以另一地区换算值补齐。

**若未来重新启动，账号准备步骤为：**按上表申请淘宝联盟与Rakuten应用，并将“价格查询、在微信小程序公开展示”的用途如实填写；记录审核结果、接口权限和配额。凭据获批后配置到后端环境变量。团队无需先申请全部平台，也无需先换服务器。账号注册、验证码与平台审核由账号持有人完成。

可用于申请的用途说明草稿（应按真实情况填写平台要求字段）：

> 我们运营高达模型目录微信小程序，拟在模型详情页提供已核对型号和版本的新品在售报价，国内人民币、日本日元分开展示，注明来源、条件及更新时间。首批验证20款，报价由后端按配额获取并按许可期限缓存。需要确认本应用可申请的查询／比价场景权限，以及在小程序展示、署名和保存数据的要求。

若平台要求当前项目尚不具备的导购入口、媒体类型或资质，先确认是否可申请适用方案，再决定是否增加相关产品功能；不把未实现能力写成已有功能。

### 2. 先验证20款，再开始页面开发

建议样本配额HG 8款、RG 5款、MG 5款、PG 2款，跨样本包含通贩、限定、透明版和套装。这里只是抽样设计，不能据此推定来源覆盖率。

1. 将目录modelId与每个平台的具体商品／规格ID、JAN或ASIN建立映射，逐项核对比例、版本、涂装、套装内容及商品状态。
2. 区分未组装新品、二手、现货、预售、定金、配件及多规格链接。平台只返回链接起售价且无法确认目标规格时，该条不进入参考价。
3. 取得实际价格响应，核对税、运费、优惠门槛、库存及更新时间。淘宝预估到手价可能包含优惠或预售定金＋尾款，不能直接作为人人可得的现货价。[价格字段定义](https://developer.alibaba.com/docs/api.htm?apiId=64759)
4. 输出20款覆盖表：准确匹配／未覆盖／需人工核对、可用报价口径、能否公开展示、能否留存。只有可核验条目进入首批功能；未覆盖的数量如实列明，不用相近款代替。

建议将“试点通过”定义为：应用用途及权限确认可用，20款的核对状态全部填写，每个地区至少16款有可展示的准确当前报价，拟上线绑定误匹配为0；并在48小时、每6小时一次的8批刷新中，至少7批取得这些绑定的有效报价。这个覆盖门槛是本方案的建议验收值，不是平台能力承诺。任一地区未达标，先调整来源或样本并重新验证，不宣称双地区行情已经可上线；历史数据采购是否完成不阻挡已通过的当前报价功能单独验收。

首批以“新品现货的商品价”为建议主口径，优惠价单列并带条件；运费未知时明确标注。报价数量不足以形成区间时仅显示该渠道报价，不称为整个市场均价。后续先扩至100款，覆盖与维护成本可接受后再扩大到2247款。

### 3. 当前报价与历史数据分别处理

当前报价建议每6小时刷新一次，并显示具体采集时间；实际频率不得超过平台配额或允许的刷新方式。页面称“市场参考价”，不承诺逐秒实时。

Rakuten价格及可售性缓存上限为24小时，需要在报价旁显示更新时间并按其要求署名。过期刷新失败时，该来源显示暂不可用；其价格响应、日志和备份的留存也要符合许可，不能通过永久保存快照或年度汇总规避24小时限制。[官方缓存与显示规则](https://webservice.faq.rakuten.net/hc/ja/articles/900001974343)

往年价格有两条实际路径：

- **已有年份回填：**国内向历史数据提供方询价，日本核实Keepa对应ASIN的记录；只在样本可用、口径清楚且允许本用途时采购／导入。没有记录的年份保留“暂无数据”，不承诺上线就覆盖所有往年。
- **从现在起积累：**仅对明确允许长期保存与年度统计的数据源记录快照。普通查询接口免费，不等于获得历史库留存许可；Rakuten当前缓存数据不默认进入永久历史表。

年度参考按同地区、币种、来源、成色和价格口径分组，建议用有效日参考价的中位数及范围，注明实际覆盖天数／月份。历史数据若只有价格变更事件，先按已知有效区间还原日价；缺货、未知、跟踪前时段不补价，不能直接对事件条数求中位数。仅有部分月份时标“已覆盖月份参考”，不称全年行情。

可长期统计的数据采用以下日价算法：按地区当地日期分组，同一已核对款式、同一独立商家当天只取日末前最后一个有效报价；同店重复商品链接先去重，再对各独立商家报价求中位数作为当日日参考价，只有一家时标为单店日参考。有效报价必须符合来源的有效期、库存及口径要求；不把过期缓存、未知或缺货延续为日价，也不把短期缓存来源默认写入长期统计。年度再对这些有效日价求中位数，每个有效日权重相同。历史源只有一条平台价格序列时按该序列有效区间取日价，并始终保留平台与序列标签。

Keepa部分价格序列在2026-02-23前后有运费口径变化，接入时分段处理。其数据代表Amazon.co.jp的相应报价序列，覆盖起点取决于商品实际跟踪记录。[Keepa历史对象](https://keepa.com/api-docs/product-object.html)

向数据方询价时，至少取得：20款样本的商品标识、时间覆盖与缺失段、现货／成色、含税运费及优惠口径、报价或成交属性、小程序展示和长期保存范围、接口／批量导入方式、月费／最低消费。未拿到这些结果前不按未知套餐编预算。

### 4. 项目内的最小改动范围

继续使用现有Express、MySQL和`wx.cloud.callContainer`。第三方接口由后端统一调用，小程序读取自己的缓存接口；现阶段无需为此新增服务器、Redis或消息队列，实际容量由试点验证。

- 后台先增加商品映射与核对入口，再接入选定平台的采集命令。管理员手动刷新跑通后，部署单一调度任务，并验证限流、防重及失败处理；浏览页面不逐卡请求第三方平台。
- 数据按用途分开：商品映射、带到期时间的当前报价缓存、获准长期保存的历史观测。沿用现有modelId作为关联，官方价格继续保留；年度统计先从许可内的历史观测计算。
- 首批在模型详情展示国内／日本报价、来源、条件、时间及有数据的年度参考；报价模块具有独立加载、错误与重试状态，接口失败时模型资料仍可查看。列表和心愿单批量行情等待试点后再评估。
- 已购价只在同款、同币种、同条件且有对应时期数据时比较。当前购买记录是人民币，首批可比较国内参考；日本历史保持日元展示，跨币种比较另需购买时期的历史汇率。缺购入日期时不生成往年价结论。

### 5. 费用控制与验收

| 项目 | 本阶段安排 |
|---|---|
| 账号和当前报价 | 优先申请公开可用的低成本方案；免费接口仍受资格、权限和配额限制，实际以账号为准 |
| 现有云托管／MySQL | 复用现有服务，先测新增请求量、响应耗时和存储；不能保证账单完全不变 |
| 历史数据 | 单独询价与样本验证，不把Keepa文档里的计费演示金额当成实际套餐价，也不承诺慢慢买的未核实费用 |
| 请求量估算 | 若每款每地区一次刷新需要1次调用，20款×2地区×每日4次约160次／日；分页、多商家、重试会增加调用，真正配额按样本实测计算 |
| 扩展范围 | 20款→100款→完整目录，每阶段记录准确匹配率、未覆盖项、请求和维护成本 |

账号／用途及样本通过后，开发验收至少覆盖：限定版不误配通贩、定金不当全款、单币种独立计算、优惠门槛可见、缓存过期与限流／失败重试、未知与缺货不当0元、历史缺失不补造、同口径年度统计、个人购买记录不进入公共行情。最后进行小程序模拟器及真机验证，再更新后端、执行目录关联的增量迁移、上传小程序体验版、审核发布。

本次只更新接入文档，不执行数据库迁移或发布，也不改变此前已经准备的目录导入SQL与后端上传包。平台审核及数据采购耗时未知，开发排期在20款样本通过后再确定。
