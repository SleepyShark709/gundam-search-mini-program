# 微信小程序样式检查与修复报告

日期：2026-10-31（北京时间）  
实际项目：`/Users/shark/WeChatProjects/gundam-menu`  
环境：原生微信小程序，TypeScript + Less，微信开发者工具模拟器。

后续已按用户授权完成进一步的 13 项修复与工程检查，追加心愿单／已购买加载与重试，修复昵称头像持久缓存、开发／真机调试默认连接及系列列表筛选，最新实施状态、126 项测试结果、2026-11-01目录更新及验证边界见[检查、修改建议与实施记录](/Users/shark/WeChatProjects/gundam-menu/REVIEW_AND_RECOMMENDATIONS_2026-10-31.md)。本文件保留首次检查的范围与证据。

本次围绕论坛屏蔽、心愿单右侧卡片横向裁切、输入框裁切检查和修改。桌面网页布局和网页键盘操作不属于本次目标。此前针对 `/Users/shark/code/gundam-menu` 的 Web 报告不能作为此小程序的缺陷清单。

## 结果

| 项目 | 结果 | 证据 |
|---|---|---|
| 屏蔽论坛 | 已完成 | 原生底部 tab 只剩“浏览／我的”；论坛、帖子详情、发帖页面已取消注册 |
| 购买弹层输入框右侧裁切 | 已复现并修复 | 修复前整列表单右侧超出弹层；修复后 320px 下输入框和备注框均位于 x=13～307px，左右留白完整 |
| 搜索框垂直尺寸不一致 | 已修复并验证 | 内部控件高度改为跟随外框内容区，移除强制整框行高；占位文字及中英文、数字输入均完整显示 |
| 心愿单右侧卡片只显示约三分之二 | 当前重新编译版本未复现，本轮未重复改动 | 当前源码已有相关布局修复；320px、390px 下普通及最长型号名称样本均保持完整两列 |

## 本轮修改

### 1. 论坛入口和页面屏蔽

文件：[app.json](/Users/shark/WeChatProjects/gundam-menu/miniprogram/app.json:2)。

- 删除底部“论坛”tab，保留“浏览”和“我的”。
- 取消 `pages/forum/forum`、`pages/post-detail/post-detail`、`pages/post-create/post-create` 三个页面注册，防止新版本继续通过页面路由进入。
- 保留页面源码与后端实现。本次屏蔽范围是新版小程序入口和页面访问，没有停用后台 API。

验证：配置 JSON 可解析，剩余五个页面的配套文件全部存在；开发者工具重编译后仅显示两个 tab，浏览与我的可正常切换。

### 2. 购买表单横向裁切

文件：[purchase-form.less](/Users/shark/WeChatProjects/gundam-menu/miniprogram/components/purchase-form/purchase-form.less:65)。

**原因：** `.sheet-content` 是 `scroll-view`，默认宽度叠加左右 `32rpx` 内边距，使整列内容超出弹层；外层 `overflow: hidden` 将超出部分裁掉。全局针对 `view/text/image` 的盒模型规则没有覆盖此滚动容器。备注框本身也没有明确的宽度与盒模型约束。

**修改：** 为 `.sheet-content` 添加 `box-sizing: border-box`；为 `.form-textarea` 添加 `width: 100%` 和 `box-sizing: border-box`。合计新增三行样式。

**模拟器验证：** 320px 宽度下，滚动容器为 x=0、宽=320px；价格、渠道及备注控件均为 x=13、宽=294px、右边界=307px。右边框完整，备注可显示多行中英文，滚动到底后“保存”按钮完整可达。没有提交测试购买记录。

### 3. 搜索框高度修正

文件：[search-bar.less](/Users/shark/WeChatProjects/gundam-menu/miniprogram/components/search-bar/search-bar.less:22)。

**原因：** 外框设计高度为 `80rpx` 且包含上下边框，内部 input 又固定为 `80rpx`，与实际内容区高度不一致；input 与 placeholder 还被强制设为整框 `80rpx` 行高。

**修改：** input 高度改为 `100%`，移除 input 和 placeholder 的固定 `80rpx` 行高。

**模拟器验证：** HG 系列页的空占位文字、输入“高达 RX-78 ABC 123”后的文字和清除按钮完整显示，输入可触发筛选；测试内容已清除。

## 心愿单卡片核验

用户确认问题是右侧整张卡片横向越界，而非名称省略或商品图片裁切。因此没有修改名称高度、图片展示模式或卡片圆角。

当前仓库已有提交 `0a8e9f6`，将心愿单滚动容器上的水平 padding 移至内部网格，避免滚动容器与网格重复叠加留白。位置：[wishlist.less](/Users/shark/WeChatProjects/gundam-menu/miniprogram/pages/wishlist/wishlist.less:19)、[wishlist.wxml](/Users/shark/WeChatProjects/gundam-menu/miniprogram/pages/wishlist/wishlist.wxml:28)。

本次重新编译后的验证：

- 390px：左卡 x=12、宽=180px、右边界=192px；右卡 x=198、宽=180px、右边界=378px，两张卡均完整位于视口内。
- 320px：使用真实模型数据中名称最长的六个模型进行内存渲染，右侧卡片完整显示，没有重现只露出三分之二。
- 六张卡片可滚动至最后一排，底部价格与卡片边缘可见。

这些结果证明当前模拟器编译产物的布局正常，但不能反推用户此前出现问题时的包版本或运行状态。原先横向裁切的完整现场未重现，不将宿主选择器、名称高度等猜测性改动当作修复。

## 检查与验证边界

- 两份修改后的 Less 均由现有本地 Less 编译器编译成功；没有安装新依赖或修改锁文件。
- `app.json` 路由、tab 配置及剩余页面文件完整性检查通过。
- `git diff --check` 通过。业务改动仅涉及一份 JSON 和两份 Less。
- 全仓 TypeScript 检查存在既有声明冲突及类型缺失，未作为本次配置、样式改动的通过项。
- 本地 API 在当前环境不可达，部分图片请求返回 503。心愿单样式验证使用页面内存注入真实模型样本，没有调用收藏增删或购买保存接口；测试状态已恢复，模拟器已切回原 iPhone 12/13 尺寸。

附带观察：HG 列表出现一次 `setData` 约 **1188KB** 的开发工具性能提示（[series.ts:115](/Users/shark/WeChatProjects/gundam-menu/miniprogram/pages/series/series.ts:115)），建议后续单独评估列表传输与渲染开销，本轮未扩大修改。
