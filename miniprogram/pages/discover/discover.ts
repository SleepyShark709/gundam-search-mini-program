import { canShareKind, getFeatures, isFeatureEnabled, FeatureKey } from '../../utils/feature-flags';
import { bindPageFeatures, unbindPageFeatures } from '../../utils/feature-page';
import { getAllModels, refreshModelsWithStatus } from '../../utils/model-service';
import { getPurchases, loadPurchases } from '../../utils/purchase-service';
import { createShare } from '../../utils/hangar-service';
import { LINEAGES } from '../../data/lineages';
import { discoveryMode, lineageById, lineageProgress, modelFacts, recentModels, searchCatalog, toggleCompareSelection } from '../../utils/discovery';
import { GundamModel, SeriesCode } from '../../utils/types';

const PAGE_SIZE = 40;

Page({
  data: {
    features: getFeatures(),
    featureEnabled: false,
    mode: 'search',
    title: '全局搜索',
    modeNotice: '',
    keyword: '',
    models: [] as (ReturnType<typeof modelFacts> & { selected: boolean })[],
    total: 0,
    visibleCount: PAGE_SIZE,
    refreshing: false,
    refreshError: false,
    lineageTabs: LINEAGES.map(({ id, name }) => ({ id, name })),
    lineageId: LINEAGES[0].id,
    lineage: lineageProgress(LINEAGES[0], [], [], false),
    purchasesKnown: false,
    purchasesLoading: false,
    purchasesError: false,
    selectedIds: [] as string[],
    selectedModels: [] as ReturnType<typeof modelFacts>[],
    comparisonRows: [] as { label: string; left: string; right: string }[],
    shareId: '',
    generatingShare: false,
    shareError: '',
  },
  catalog: [] as GundamModel[],
  active: true,
  refreshRevision: 0,
  purchaseRevision: 0,
  shareRevision: 0,

  onLoad(query: { mode?: string; keyword?: string }) {
    this.active = true;
    this.shareRevision++;
    this.purchaseRevision++;
    const mode = discoveryMode(query.mode);
    let keyword = query.keyword || '';
    try { keyword = decodeURIComponent(keyword); } catch {}
    const titles = { search: '全局搜索', new: '近期发售目录', lineage: '机体谱系', compare: '两台 PK' };

    this.setData({
      mode, title: titles[mode], keyword: keyword.slice(0, 100),
      visibleCount: PAGE_SIZE, selectedIds: [], selectedModels: [], comparisonRows: [],
      shareId: '', generatingShare: false, shareError: '', purchasesLoading: false, purchasesError: false,
      modeNotice: query.mode && !['search', 'new', 'lineage', 'compare'].includes(query.mode) ? '入口已更新，已为你打开全局搜索' : '',
      purchasesKnown: false,
    });
    unbindPageFeatures(this);
    const key: FeatureKey = mode === 'lineage' || mode === 'compare' ? mode : 'discovery';
    bindPageFeatures(this, key, (enabled) => {
      this.refreshRevision++;
      this.purchaseRevision++;
      this.shareRevision++;
      this.setData({ refreshing: false, purchasesLoading: false, shareId: '', generatingShare: false, shareError: '' });
      if (!enabled) return;
      this.catalog = getAllModels();
      this.setData({ purchasesKnown: getPurchases().length > 0 });
      this.updateResults();
      void this.refreshCatalog();
      if (mode === 'lineage') void this.refreshPurchases();
    });
  },
  onShow() {
    if (this.data.featureEnabled && this.data.mode === 'lineage') this.refreshPurchases();
  },
  onUnload() {
    this.active = false;
    unbindPageFeatures(this);
    this.refreshRevision++;
    this.purchaseRevision++;
    this.shareRevision++;
  },
  handleBack() {
    wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/home/home' }) });
  },
  async refreshCatalog() {
    if (!this.isAvailable()) return;
    const revision = ++this.refreshRevision;
    this.setData({ refreshing: true, refreshError: false });
    const results = await Promise.allSettled((['hg', 'rg', 'mg', 'pg'] as SeriesCode[]).map(async (code) => {
      const { models, refreshed } = await refreshModelsWithStatus(code);
      if (this.active && revision === this.refreshRevision && models.length) {
        this.catalog = [...this.catalog.filter((model: GundamModel) => model.series !== code), ...models];
        // 始终使用当前输入与选择，后台返回不恢复旧查询。
        this.updateResults();
      }
      return refreshed;
    }));
    if (!this.active || revision !== this.refreshRevision) return;
    this.setData({ refreshing: false, refreshError: results.some((result) => result.status === 'rejected' || !result.value) });
  },
  async refreshPurchases() {
    if (!this.isAvailable()) return;
    const revision = ++this.purchaseRevision;
    this.setData({ purchasesLoading: true, purchasesError: false });
    let success = false;
    try { success = await loadPurchases(); } catch {}
    if (!this.active || revision !== this.purchaseRevision) return;
    this.setData({ purchasesLoading: false, purchasesError: !success, purchasesKnown: success || this.data.purchasesKnown });
    this.updateLineage();
  },
  isAvailable() {
    const mode = this.data.mode;
    return this.active && isFeatureEnabled(mode === 'lineage' || mode === 'compare' ? mode : 'discovery');
  },
  updateLineage() {
    if (!this.isAvailable()) return;
    this.setData({ lineage: lineageProgress(lineageById(this.data.lineageId), this.catalog, getPurchases(), this.data.purchasesKnown) });
  },
  updateResults() {
    if (!this.isAvailable()) return;
    const found = this.data.mode === 'new' ? recentModels(this.catalog) : searchCatalog(this.catalog, this.data.keyword);
    const selectedModels = this.data.selectedIds.map((id) => this.catalog.find((model: GundamModel) => model.id === id))
      .filter((model): model is GundamModel => !!model).map(modelFacts);
    const left = selectedModels[0];
    const right = selectedModels[1];
    const comparisonRows = left && right ? [
      { label: '模型等级', left: left.grade, right: right.grade },
      { label: '比例', left: left.scale, right: right.scale },
      { label: '官方日元价', left: left.priceText, right: right.priceText },
      { label: '目录发售日期', left: left.dateText, right: right.dateText },
      { label: '限定属性', left: left.limitedText, right: right.limitedText },
    ] : [];
    this.setData({
      models: found.slice(0, this.data.visibleCount).map((model) => ({ ...modelFacts(model), selected: this.data.selectedIds.includes(model.id) })),
      total: found.length, selectedModels, comparisonRows,
    });
    if (this.data.mode === 'lineage') this.updateLineage();
  },
  handleKeywordInput(e: WechatMiniprogram.Input) {
    if (!this.isAvailable()) return;
    this.setData({ keyword: e.detail.value, visibleCount: PAGE_SIZE });
    this.updateResults();
  },
  handleSearch() {
    if (!this.isAvailable()) return;
    this.setData({ visibleCount: PAGE_SIZE });
    this.updateResults();
  },
  handleLoadMore() {
    if (!this.isAvailable()) return;
    this.setData({ visibleCount: this.data.visibleCount + PAGE_SIZE });
    this.updateResults();
  },
  handleLineage(e: WechatMiniprogram.TouchEvent) {
    if (!this.isAvailable()) return;
    this.setData({ lineageId: lineageById(e.currentTarget.dataset.id).id });
    this.updateLineage();
  },
  handleModel(e: WechatMiniprogram.TouchEvent) {
    if (!this.isAvailable()) return;
    const id = e.currentTarget.dataset.id;
    if (!this.catalog.some((model: GundamModel) => model.id === id)) return;
    wx.navigateTo({ url: `/pages/model/model?id=${encodeURIComponent(id)}` });
  },
  handleSource(e: WechatMiniprogram.TouchEvent) {
    if (!this.isAvailable()) return;
    const url = e.currentTarget.dataset.url;
    if (url) wx.setClipboardData({ data: url });
  },
  handleSelectModel(e: WechatMiniprogram.TouchEvent) {
    if (!this.isAvailable()) return;
    const id = e.currentTarget.dataset.id;
    if (!this.catalog.some((model: GundamModel) => model.id === id)) return;
    const selection = toggleCompareSelection(this.data.selectedIds, id);
    if (selection.full) {
      wx.showToast({ title: '最多两台，请先移除一台', icon: 'none' });
      return;
    }
    this.shareRevision++;
    this.setData({ selectedIds: selection.ids, shareId: '', generatingShare: false, shareError: '' });
    this.updateResults();
  },
  async handlePrepareShare() {
    if (!this.isAvailable() || !canShareKind('compare')) return;
    if (this.data.selectedIds.length !== 2 || this.data.generatingShare) return;
    const revision = ++this.shareRevision;
    const modelIds = [...this.data.selectedIds];
    this.setData({ generatingShare: true, shareId: '', shareError: '' });
    try {
      const snapshot = await createShare({ kind: 'compare', title: '我的下一台出击', modelIds });
      if (!snapshot.id) throw new Error('未返回分享编号');
      if (!this.active || revision !== this.shareRevision) return;
      this.setData({ shareId: snapshot.id, generatingShare: false });
    } catch {
      if (!this.active || revision !== this.shareRevision) return;
      this.setData({ generatingShare: false, shareError: '对比卡生成失败，请重试' });
    }
  },
  onShareAppMessage() {
    return this.isAvailable() && canShareKind('compare') && this.data.mode === 'compare' && this.data.shareId
      ? { title: '我的下一台出击', path: `/pages/share/share?id=${encodeURIComponent(this.data.shareId)}` }
      : { title: '高达模型目录 · 发现你的下一台', path: '/pages/home/home' };
  },
});
