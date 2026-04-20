import { getAllModels } from '../../utils/model-service';
import { getPurchases, getPurchaseRecord, updatePurchase, removePurchase, loadPurchases } from '../../utils/purchase-service';
import { isInWishlist, toggleWishlist } from '../../utils/cloud-favorites';
import type { GundamModel, PurchaseRecord, SeriesCode } from '../../utils/types';

// ---------- 辅助类型 ----------

interface PurchaseItem {
  modelId: string;
  model: GundamModel;
  record: PurchaseRecord;
  seriesLabel: string;
  numberText: string;
  displayDate: string;
  priceText: string;
}

interface SeriesBreakdownItem {
  code: string;
  label: string;
  count: number;
  percent: number;
}

// ---------- 工具函数 ----------

/** 金额格式化：toFixed(2) + 千分位逗号 */
function formatMoney(value: number): string {
  const fixed = value.toFixed(2);
  const [intPart, decPart] = fixed.split('.');
  const withComma = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${withComma}.${decPart}`;
}

/** 系列 code -> 大写标签 */
function seriesLabel(code: SeriesCode): string {
  return code.toUpperCase();
}

/** 趣味文案 */
function getSavedFunText(savedRate: number): string {
  if (savedRate < -5) return '情怀无价，高达魂燃烧中';
  if (savedRate < 5) return '精准花费，量子级节约';
  if (savedRate < 15) return '不错的操作，驾驶员';
  if (savedRate < 25) return '精打细算的NewType';
  return '你就是红色彗星！';
}

/** 驾驶员评级 */
function getPilotRating(avgScore: number): { pilotRank: string; pilotTitle: string } {
  const score = avgScore * 100;
  if (score >= 90) return { pilotRank: 'S级', pilotTitle: '传说中的白色恶魔' };
  if (score >= 70) return { pilotRank: 'A级', pilotTitle: 'NewType觉醒' };
  if (score >= 50) return { pilotRank: 'B级', pilotTitle: '合格的驾驶员' };
  if (score >= 30) return { pilotRank: 'C级', pilotTitle: '新兵训练中' };
  return { pilotRank: 'D级', pilotTitle: '刚入坑的联邦士兵' };
}

// ---------- 页面 ----------

Page({
  _allModels: [] as GundamModel[],
  _touchStartX: 0,
  _touchStartY: 0,
  _touchStartIndex: -1,
  _isHorizontalSwipe: false,
  _directionLocked: false,
  _baseOffsetPx: 0,
  _openOffsetPx: 0,

  data: {
    // 列表数据
    purchaseItems: [] as PurchaseItem[],
    loading: true,
    statusBarHeight: 20,
    safeAreaBottom: 0,
    exchangeRate: 0.05,

    // 统计区
    hasStats: false,
    totalCount: 0,
    totalSpentText: '0.00',
    totalOriginalText: '0.00',
    hasCompare: false,
    spentPercent: 0,
    savedAmountText: '0.00',
    savedIsNegative: false,
    savedFunText: '',
    seriesBreakdown: [] as SeriesBreakdownItem[],

    // 雷达图
    radarDimensions: [0, 0, 0, 0, 0] as number[],
    pilotRank: 'D级',
    pilotTitle: '刚入坑的联邦士兵',

    // 得分详情
    scoreDetailOpen: false,
    pilotScore: 0,
    nextRank: '',
    nextRankScore: 0,
    scoreGap: 0,
    dimDetails: [] as Array<{ label: string; valueText: string; percent: number }>,
    upgradeTip: '',

    // 左滑
    swipeOpenIndex: -1,
    activeSwipeIndex: -1,
    activeSwipeStyle: '',
    canScrollY: true,

    // 详情弹窗
    selectedModel: null as GundamModel | null,
    detailOpen: false,
    selectedIsWishlist: false,

    // 编辑表单
    formOpen: false,
    formModelId: '',
    formModelName: '',
    formPriceCny: null as number | null,
    formPurchaseDate: null as string | null,
    formChannel: null as string | null,
    formNote: null as string | null,
  },

  onLoad() {
    const app = getApp<IAppOption>();
    this._allModels = getAllModels();
    // 176rpx（删除按钮宽 148rpx + 右侧间距）对应到当前设备的 px
    this._openOffsetPx = 176 * app.globalData.windowWidth / 750;
    this.setData({
      statusBarHeight: app.globalData.statusBarHeight,
      exchangeRate: app.globalData.exchangeRate || 0.05,
      safeAreaBottom: app.globalData.safeAreaBottom,
    });
  },

  async onShow() {
    await loadPurchases();
    this.refreshList();
    const app = getApp<IAppOption>();
    if (app.globalData.exchangeRate) {
      this.setData({ exchangeRate: app.globalData.exchangeRate });
    }
  },

  refreshList() {
    const purchases = getPurchases();
    const purchaseMap = new Map<string, PurchaseRecord>();
    for (const p of purchases) {
      purchaseMap.set(p.modelId, p);
    }

    // 合并为 PurchaseItem[]
    const purchaseItems: PurchaseItem[] = [];
    for (const model of this._allModels) {
      const record = purchaseMap.get(model.id);
      if (!record) continue;
      purchaseItems.push({
        modelId: model.id,
        model,
        record,
        seriesLabel: seriesLabel(model.series),
        numberText: String(model.number).padStart(3, '0'),
        displayDate: record.purchaseDate || '未填写',
        priceText: record.priceCny != null ? record.priceCny.toFixed(2) : '',
      });
    }

    // 排序：按 purchaseDate 降序，null 排最后；null 之间按 createdAt 降序
    purchaseItems.sort((a, b) => {
      const dateA = a.record.purchaseDate;
      const dateB = b.record.purchaseDate;
      if (dateA && dateB) return dateB.localeCompare(dateA);
      if (dateA && !dateB) return -1;
      if (!dateA && dateB) return 1;
      // 都是 null，按 createdAt 降序
      return (b.record.createdAt || '').localeCompare(a.record.createdAt || '');
    });

    const exchangeRate = this.data.exchangeRate;

    // ---------- 统计计算 ----------

    const totalCount = purchaseItems.length;
    const hasStats = totalCount > 0;

    // 总花费 & 原价折合（只算有实付价的记录）
    let totalSpent = 0;
    let totalOriginal = 0;
    let priceRecordCount = 0;

    for (const item of purchaseItems) {
      if (item.record.priceCny != null) {
        totalSpent += item.record.priceCny;
        totalOriginal += item.model.price * exchangeRate;
        priceRecordCount++;
      }
    }

    const hasCompare = priceRecordCount > 0;
    const savedAmount = totalOriginal - totalSpent;
    const spentPercent = totalOriginal > 0 ? Math.min(Math.round(totalSpent / totalOriginal * 100), 100) : 0;
    // 省钱率 = 20%(容忍加价) - 实际溢价率，买到原价即 20%，超出原价 20% 才为 0
    const premiumRate = totalOriginal > 0 ? ((totalSpent - totalOriginal) / totalOriginal * 100) : 0;
    const savedRate = 20 - premiumRate;
    const savedFunText = getSavedFunText(savedRate);
    const savedIsNegative = savedAmount < 0;

    // 系列分布
    const seriesCountMap: Record<string, number> = {};
    for (const item of purchaseItems) {
      const code = item.model.series;
      seriesCountMap[code] = (seriesCountMap[code] || 0) + 1;
    }

    const seriesOrder: SeriesCode[] = ['hg', 'rg', 'mg', 'pg'];
    const seriesBreakdown: SeriesBreakdownItem[] = [];
    for (const code of seriesOrder) {
      const count = seriesCountMap[code] || 0;
      if (count > 0) {
        seriesBreakdown.push({
          code,
          label: code.toUpperCase(),
          count,
          percent: totalCount > 0 ? Math.round(count / totalCount * 100) : 0,
        });
      }
    }

    // ---------- 雷达图5维 ----------

    // 1. 总台数 / 20
    const dimCount = Math.min(totalCount / 20, 1);

    // 2. 总花费 / 10000
    const dimSpent = Math.min(totalSpent / 10000, 1);

    // 3. 省钱率 / 25
    const dimSaved = Math.min((savedRate > 0 ? savedRate : 0) / 25, 1);

    // 4. 覆盖度：不同系列数 / 4
    const uniqueSeriesCount = Object.keys(seriesCountMap).length;
    const dimCoverage = Math.min(uniqueSeriesCount / 4, 1);

    // 5. 频率：最近3个月月均购买量（月均2台为满分）
    const now = new Date();
    const threeMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 3, now.getDate());
    const threeMonthsAgoStr = threeMonthsAgo.toISOString().slice(0, 10);
    let recent3MonthCount = 0;
    for (const item of purchaseItems) {
      if (item.record.purchaseDate && item.record.purchaseDate >= threeMonthsAgoStr) {
        recent3MonthCount++;
      }
    }
    const dimFreq = Math.min(recent3MonthCount / 3 / 2, 1);

    const radarDimensions = [dimCount, dimSpent, dimSaved, dimCoverage, dimFreq];

    // 驾驶员评级（加权：台数1.5 > 花费1.2 > 覆盖1.0 > 频率0.8 > 省钱0.5）
    const weights = [1.5, 1.2, 0.5, 1.0, 0.8];
    const weightedSum = radarDimensions.reduce((sum, v, i) => sum + v * weights[i], 0);
    const avgScore = weightedSum / weights.reduce((sum, w) => sum + w, 0);
    const { pilotRank, pilotTitle } = getPilotRating(avgScore);

    // ---------- 得分详情 ----------

    const pilotScore = Math.round(avgScore * 100);

    // 下一等级
    const rankThresholds = [
      { rank: 'S级', score: 90 },
      { rank: 'A级', score: 70 },
      { rank: 'B级', score: 50 },
      { rank: 'C级', score: 30 },
    ];
    let nextRank = '';
    let nextRankScore = 0;
    let scoreGap = 0;
    for (const t of rankThresholds) {
      if (pilotScore < t.score) {
        nextRank = t.rank;
        nextRankScore = t.score;
        scoreGap = t.score - pilotScore;
      }
    }

    // 各维度详情
    const dimLabels = ['台数', '花费', '省钱', '覆盖', '频率'];
    const dimMaxTexts = ['20台', '¥10,000', '25%', '4系列', '2台·月'];
    const dimCurrentTexts = [
      `${totalCount}`,
      `¥${formatMoney(totalSpent)}`,
      `${Math.max(savedRate, 0).toFixed(0)}%`,
      `${uniqueSeriesCount}`,
      `${(recent3MonthCount / 3).toFixed(1)}`,
    ];
    const dimDetails = dimLabels.map((label, i) => ({
      label,
      valueText: `${dimCurrentTexts[i]}/${dimMaxTexts[i]}`,
      percent: Math.round(radarDimensions[i] * 100),
    }));

    // 升级建议：找加权得分最低的维度
    const weightedDimScores = radarDimensions.map((v, i) => ({ index: i, weighted: v * weights[i] }));
    weightedDimScores.sort((a, b) => a.weighted - b.weighted);
    const weakest = weightedDimScores[0];
    const tipMap = [
      '多入手几台心仪的高达吧',
      '买买买，花费越高评分越高',
      `多找折扣渠道，省钱率达 25% 即满分`,
      '尝试不同系列，集齐HG/RG/MG/PG',
      '保持购买频率，月均2台即满分',
    ];
    const upgradeTip = tipMap[weakest.index];

    // ---------- setData ----------

    this.setData({
      purchaseItems,
      loading: false,
      hasStats,
      totalCount,
      totalSpentText: formatMoney(totalSpent),
      totalOriginalText: formatMoney(totalOriginal),
      hasCompare,
      spentPercent,
      savedAmountText: formatMoney(Math.abs(savedAmount)),
      savedIsNegative,
      savedFunText,
      seriesBreakdown,
      radarDimensions,
      pilotRank,
      pilotTitle,
      pilotScore,
      nextRank,
      nextRankScore,
      scoreGap,
      dimDetails,
      upgradeTip,
      swipeOpenIndex: -1,
    });

    // 绘制雷达图（需等待 wx:if 条件渲染完成后 canvas 才存在于 DOM）
    if (hasStats) {
      wx.nextTick(() => {
        this.drawRadar();
      });
    }
  },

  drawRadar() {
    const query = wx.createSelectorQuery();
    query.select('#radarCanvas').fields({ node: true, size: true }).exec((res) => {
      if (!res || !res[0] || !res[0].node) return;

      const canvas = res[0].node;
      const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
      const dpr = wx.getWindowInfo().pixelRatio;
      const width = res[0].width;
      const height = res[0].height;

      canvas.width = width * dpr;
      canvas.height = height * dpr;
      ctx.scale(dpr, dpr);

      const centerX = width / 2;
      const centerY = height / 2;
      const fontSize = Math.max(11, Math.round(width * 0.06));
      const radius = Math.min(width, height) / 2 - fontSize - 10; // 留出标签空间

      const dimensions = this.data.radarDimensions;
      const labels = ['台数', '花费', '省钱', '覆盖', '频率'];
      const angleStep = (Math.PI * 2) / 5;
      const startAngle = -Math.PI / 2; // 从顶部开始

      // 清空画布
      ctx.clearRect(0, 0, width, height);

      // 获取顶点坐标的辅助函数
      const getPoint = (index: number, scale: number) => {
        const angle = startAngle + index * angleStep;
        return {
          x: centerX + Math.cos(angle) * radius * scale,
          y: centerY + Math.sin(angle) * radius * scale,
        };
      };

      // 绘制3层同心五边形网格线（30%、60%、100%）
      const gridLevels = [0.3, 0.6, 1.0];
      ctx.strokeStyle = 'rgba(0,212,255,0.1)';
      ctx.lineWidth = 1;
      for (const level of gridLevels) {
        ctx.beginPath();
        for (let i = 0; i < 5; i++) {
          const p = getPoint(i, level);
          if (i === 0) ctx.moveTo(p.x, p.y);
          else ctx.lineTo(p.x, p.y);
        }
        ctx.closePath();
        ctx.stroke();
      }

      // 绘制5条从中心到顶点的辐射线
      ctx.strokeStyle = 'rgba(0,212,255,0.1)';
      ctx.lineWidth = 1;
      for (let i = 0; i < 5; i++) {
        const p = getPoint(i, 1);
        ctx.beginPath();
        ctx.moveTo(centerX, centerY);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
      }

      // 绘制数据填充区域
      ctx.beginPath();
      for (let i = 0; i < 5; i++) {
        const value = dimensions[i];
        const p = getPoint(i, value);
        if (i === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      }
      ctx.closePath();
      ctx.fillStyle = 'rgba(0,212,255,0.2)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,212,255,0.8)';
      ctx.lineWidth = 2;
      ctx.stroke();

      // 绘制5个顶点圆点
      for (let i = 0; i < 5; i++) {
        const value = dimensions[i];
        const p = getPoint(i, value);
        ctx.beginPath();
        ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
        ctx.fillStyle = '#00d4ff';
        ctx.fill();
      }

      // 绘制5个维度标签文字
      ctx.fillStyle = '#8892b0';
      ctx.font = `${fontSize}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (let i = 0; i < 5; i++) {
        const p = getPoint(i, 1.2); // 标签在外圈之外
        ctx.fillText(labels[i], p.x, p.y);
      }
    });
  },

  // ---------- 导航 ----------

  handleBack() {
    wx.navigateBack();
  },

  handleExplore() {
    wx.switchTab({ url: '/pages/home/home' });
  },

  handleToggleScoreDetail() {
    this.setData({ scoreDetailOpen: !this.data.scoreDetailOpen });
  },

  // ---------- 卡片交互 ----------

  handleThumbTap(e: WechatMiniprogram.TouchEvent) {
    const index = e.currentTarget.dataset.index as number;
    const item = this.data.purchaseItems[index];
    if (!item) return;
    this.setData({
      selectedModel: item.model,
      detailOpen: true,
      selectedIsWishlist: isInWishlist(item.model.id),
    });
  },

  handleInfoTap(e: WechatMiniprogram.TouchEvent) {
    const index = e.currentTarget.dataset.index as number;
    const item = this.data.purchaseItems[index];
    if (!item) return;
    this.setData({
      formOpen: true,
      formModelId: item.model.id,
      formModelName: item.model.name,
      formPriceCny: item.record.priceCny,
      formPurchaseDate: item.record.purchaseDate,
      formChannel: item.record.channel,
      formNote: item.record.note,
    });
  },

  // ---------- 详情弹窗 ----------

  handleDetailClose() {
    this.setData({ detailOpen: false });
  },

  async handleToggleWishlist(e: any) {
    const id = e.detail.id;
    const nowInWishlist = await toggleWishlist(id);
    if (this.data.selectedModel && this.data.selectedModel.id === id) {
      this.setData({ selectedIsWishlist: nowInWishlist });
    }
  },

  // ---------- 编辑表单 ----------

  handlePurchaseAction(e: any) {
    const { id, name } = e.detail;
    const record = getPurchaseRecord(id);
    this.setData({
      formOpen: true,
      formModelId: id,
      formModelName: name,
      formPriceCny: record ? record.priceCny : null,
      formPurchaseDate: record ? record.purchaseDate : null,
      formChannel: record ? record.channel : null,
      formNote: record ? record.note : null,
    });
  },

  handleFormClose() {
    this.setData({ formOpen: false });
  },

  async handleFormSubmit(e: any) {
    const data = e.detail;
    const success = await updatePurchase(data.modelId, data);
    if (success) {
      this.setData({ formOpen: false });
      this.refreshList();
      wx.showToast({ title: '保存成功', icon: 'success' });
    } else {
      wx.showToast({ title: '保存失败', icon: 'none' });
    }
  },

  // ---------- 删除 ----------

  handleDelete(e: WechatMiniprogram.TouchEvent) {
    const modelId = e.currentTarget.dataset.modelId as string;
    wx.showModal({
      title: '确认删除',
      content: '删除后将移除该模型的购买记录',
      success: async (res) => {
        if (!res.confirm) return;
        const success = await removePurchase(modelId);
        if (success) {
          this.setData({ swipeOpenIndex: -1 });
          this.refreshList();
          wx.showToast({ title: '已删除', icon: 'success' });
        } else {
          wx.showToast({ title: '删除失败', icon: 'none' });
        }
      },
    });
  },

  // ---------- 左滑手势 ----------

  handleTouchStart(e: WechatMiniprogram.TouchEvent) {
    const touch = e.touches[0];
    const index = e.currentTarget.dataset.index as number;
    this._touchStartX = touch.clientX;
    this._touchStartY = touch.clientY;
    this._touchStartIndex = index;
    this._isHorizontalSwipe = false;
    this._directionLocked = false;
    // 起始偏移：若当前卡片已展开则从 -openOffsetPx 开始，否则从 0
    this._baseOffsetPx = this.data.swipeOpenIndex === index ? -this._openOffsetPx : 0;

    // 如果当前有其他卡片展开，先关闭
    if (this.data.swipeOpenIndex !== -1 && this.data.swipeOpenIndex !== index) {
      this.setData({ swipeOpenIndex: -1 });
    }
  },

  handleTouchMove(e: WechatMiniprogram.TouchEvent) {
    const touch = e.touches[0];
    const dx = touch.clientX - this._touchStartX;
    const dy = touch.clientY - this._touchStartY;

    // 方向锁定：5px 阈值，横向位移占优即锁为横向
    if (!this._directionLocked) {
      const adx = Math.abs(dx);
      const ady = Math.abs(dy);
      if (adx > 5 || ady > 5) {
        this._directionLocked = true;
        this._isHorizontalSwipe = adx > ady;
        if (this._isHorizontalSwipe) {
          // 禁用父级 scroll-view 的垂直滚动，防止误触
          this.setData({ canScrollY: false });
        }
      }
    }

    if (!this._directionLocked || !this._isHorizontalSwipe) return;

    // 跟手：实时计算偏移，允许 20px 橡皮筋过冲
    let offset = this._baseOffsetPx + dx;
    if (offset > 0) offset = 0;
    const maxLeft = -this._openOffsetPx - 20;
    if (offset < maxLeft) offset = maxLeft;

    this.setData({
      activeSwipeIndex: this._touchStartIndex,
      activeSwipeStyle: `transform: translateX(${offset}px); transition: none;`,
    });
  },

  handleTouchEnd(e: WechatMiniprogram.TouchEvent) {
    const index = this._touchStartIndex;

    if (this._directionLocked && this._isHorizontalSwipe) {
      const touch = e.changedTouches[0];
      const dx = touch.clientX - this._touchStartX;
      const offset = this._baseOffsetPx + dx;
      // 吸附：最终偏移超过一半宽度则保持展开，否则回弹
      const shouldOpen = offset < -this._openOffsetPx / 2;
      this.setData({
        swipeOpenIndex: shouldOpen ? index : -1,
        activeSwipeIndex: -1,
        activeSwipeStyle: '',
        canScrollY: true,
      });
    } else {
      // 垂直滚动或无移动：只需恢复 canScrollY（防御性）
      if (!this.data.canScrollY) {
        this.setData({ canScrollY: true });
      }
    }

    this._directionLocked = false;
    this._isHorizontalSwipe = false;
  },

  // ---------- 分享 ----------

  onShareAppMessage() {
    return {
      title: '我的高达收藏',
      path: '/pages/home/home',
    };
  },

  onShareTimeline() {
    return {
      title: '高达模型目录 - 万代高达塑料模型大全',
    };
  },
});
