import { getModels, filterModels, sortModels, refreshModels } from '../../utils/model-service';
import { loadWishlist, getWishlist, isInWishlist, toggleWishlist } from '../../utils/cloud-favorites';
import { loadPurchases, isPurchased, getPurchaseRecord, addPurchase, updatePurchase } from '../../utils/purchase-service';
import type { GundamModel, SeriesCode, FilterConfig, SortConfig } from '../../utils/types';

const SERIES_NAMES: Record<string, string> = {
  hg: 'HG - High Grade',
  rg: 'RG - Real Grade',
  mg: 'MG - Master Grade',
  pg: 'PG - Perfect Grade',
};

const SORT_OPTIONS = [
  { label: '编号↑', value: 'number-asc' },
  { label: '编号↓', value: 'number-desc' },
  { label: '价格↑', value: 'price-asc' },
  { label: '价格↓', value: 'price-desc' },
  { label: '日期↑', value: 'releaseDate-asc' },
  { label: '日期↓', value: 'releaseDate-desc' },
];

function parseSortValue(value: string): SortConfig {
  const parts = value.split('-');
  const field = parts[0] as SortConfig['field'];
  const order = parts[1] as SortConfig['order'];
  return { field, order };
}

const PAGE_SIZE = 40;

Page({
  _allModels: [] as GundamModel[],
  _processedModels: [] as GundamModel[],
  _debounceTimer: 0,
  _active: false,
  data: {
    seriesCode: 'hg' as string,
    seriesTitle: '',
    regularCount: 0,
    limitedCount: 0,
    limitedCounts: {} as Record<string, number>,
    processedModels: [] as GundamModel[],
    favMap: {} as Record<string, boolean>,

    // Search
    searchInput: '',
    debouncedKeyword: '',

    // Tab
    activeTab: 'regular',

    // Limited sub-filter
    limitedSubFilter: 'all',

    // Sort
    sortValue: 'number-asc',
    sortOptions: SORT_OPTIONS,

    // Filter panel
    filterOpen: false,
    releaseDateFrom: '',
    releaseDateTo: '',
    numberFrom: '',
    numberTo: '',

    // Detail
    selectedModel: null as GundamModel | null,
    detailOpen: false,
    selectedIsFav: false,
    selectedIsPurchased: false,

    // Purchase form
    formOpen: false,
    formModelId: '',
    formModelName: '',
    formPriceCny: null as number | null,
    formPurchaseDate: null as string | null,
    formChannel: null as string | null,
    formNote: null as string | null,

    // UI
    statusBarHeight: 20,
    loading: true,
    resultCount: 0,
    showBackTop: false,
    exchangeRate: 0.05,
    scrollTop: 0,
    safeAreaBottom: 0,
  },

  onLoad(options: any) {
    const code = (options.code || 'hg') as SeriesCode;
    const app = getApp<IAppOption>();

    this._active = true;
    this._allModels = getModels(code);

    this.setData({
      seriesCode: code,
      seriesTitle: SERIES_NAMES[code] || code.toUpperCase(),
      statusBarHeight: app.globalData.statusBarHeight,
      loading: false,
      exchangeRate: app.globalData.exchangeRate || 0.05,
      safeAreaBottom: app.globalData.safeAreaBottom,
    });

    this._updateCounts();
    this.applyFilters();

    // 异步从服务器刷新模型数据（5s 超时后降级为本地数据）
    refreshModels(code).then((newModels) => {
      if (!this._active || newModels.length === 0 || newModels === this._allModels) return;
      this._allModels = newModels;
      this._updateCounts();
      this.applyFilters();
    });
  },

  async onShow() {
    await Promise.all([loadWishlist(), loadPurchases()]);
    if (!this._active) return;
    this._refreshFavMap();
    const app = getApp<IAppOption>();
    if (app.globalData.exchangeRate) {
      this.setData({ exchangeRate: app.globalData.exchangeRate });
    }
  },

  _refreshFavMap() {
    const favorites = getWishlist();
    const favMap: Record<string, boolean> = {};
    favorites.forEach((id) => { favMap[id] = true; });
    this.setData({ favMap });
    if (this.data.selectedModel) {
      this.setData({
        selectedIsFav: isInWishlist(this.data.selectedModel.id),
        selectedIsPurchased: isPurchased(this.data.selectedModel.id),
      });
    }
  },

  // Search
  handleSearchInput(e: any) {
    const value = (e.detail && e.detail.value) || '';
    this.setData({ searchInput: value });

    if (this._debounceTimer) clearTimeout(this._debounceTimer);
    this._debounceTimer = setTimeout(() => {
      if (!this._active) return;
      this.setData({ debouncedKeyword: value });
      this.applyFilters();
    }, 300);
  },

  // Tab
  handleTabChange(e: any) {
    this.setData({
      activeTab: e.detail.tab,
      limitedSubFilter: 'all',
    });
    this.applyFilters();
  },

  // Limited filter
  handleLimitedChange(e: any) {
    this.setData({ limitedSubFilter: e.detail.value });
    this.applyFilters();
  },

  // Sort
  handleSortChange(e: any) {
    this.setData({ sortValue: e.detail.value });
    this.applyFilters();
  },

  // Filter panel
  handleBack() {
    wx.navigateBack();
  },

  handleFilterTap() {
    this.setData({ filterOpen: !this.data.filterOpen });
  },

  handleFilterChange(e: any) {
    const { field, value } = e.detail;
    this.setData({ [field]: value } as any);
    this.applyFilters();
  },

  handleFilterReset() {
    this.setData({
      releaseDateFrom: '',
      releaseDateTo: '',
      numberFrom: '',
      numberTo: '',
    });
    this.applyFilters();
  },

  handleFilterClose() {
    this.setData({ filterOpen: false });
  },

  // Model select
  handleModelSelect(e: any) {
    const model = e.detail.model;
    this.setData({
      selectedModel: model,
      detailOpen: true,
      selectedIsFav: isInWishlist(model.id),
      selectedIsPurchased: isPurchased(model.id),
    });
  },

  handleDetailClose() {
    this.setData({ detailOpen: false });
  },

  async handleToggleFavorite(e: any) {
    const id = e.detail.id;
    const result = await toggleWishlist(id);
    this._refreshFavMap();
    if (this.data.selectedModel && this.data.selectedModel.id === id) {
      this.setData({ selectedIsFav: result.isFavorite });
    }
    if (!result.success) wx.showToast({ title: '操作失败，请重试', icon: 'none' });
  },

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
    const existing = getPurchaseRecord(data.modelId);
    try {
      const saved = existing
        ? await updatePurchase(data.modelId, data)
        : await addPurchase(data);
      if (!saved) {
        wx.showToast({ title: '保存失败，请重试', icon: 'none' });
        return;
      }
      this.setData({ formOpen: false, selectedIsPurchased: true });
      this._refreshFavMap();
      wx.showToast({ title: '保存成功', icon: 'success' });
    } catch {
      wx.showToast({ title: '保存失败', icon: 'none' });
    }
  },

  // Scroll
  handleScroll(e: any) {
    const scrollTop = e.detail.scrollTop;
    const show = scrollTop > 500;
    if (show !== this.data.showBackTop) {
      this.setData({ showBackTop: show });
    }
  },

  handleBackTop() {
    this.setData({ scrollTop: 0 });
  },

  handleLoadMore() {
    const offset = this.data.processedModels.length;
    const next: GundamModel[] = this._processedModels.slice(offset, offset + PAGE_SIZE);
    const update: Record<string, GundamModel> = {};
    next.forEach((model, index) => { update[`processedModels[${offset + index}]`] = model; });
    if (next.length) this.setData(update);
  },

  onUnload() {
    this._active = false;
    if (this._debounceTimer) clearTimeout(this._debounceTimer);
  },

  onShareAppMessage() {
    const { seriesCode, seriesTitle } = this.data;
    return {
      title: `${seriesTitle} - 高达模型目录`,
      path: `/pages/series/series?code=${seriesCode}`,
    };
  },

  onShareTimeline() {
    const { seriesCode, seriesTitle } = this.data;
    return {
      title: `${seriesTitle} - 高达模型目录`,
      query: `code=${seriesCode}`,
    };
  },

  // Apply all filters and sorting
  _updateCounts() {
    const limitedCounts: Record<string, number> = { all: 0 };
    let regularCount = 0;
    const allModels: GundamModel[] = this._allModels;
    allModels.forEach((model) => {
      if (!model.isLimited) { regularCount++; return; }
      limitedCounts.all++;
      const type = model.limitedType || 'other';
      limitedCounts[type] = (limitedCounts[type] || 0) + 1;
    });
    this.setData({ regularCount, limitedCount: limitedCounts.all, limitedCounts });
  },

  applyFilters() {
    const { activeTab, limitedSubFilter, debouncedKeyword, releaseDateFrom, releaseDateTo, numberFrom, numberTo, sortValue } = this.data;

    const allModels: GundamModel[] = this._allModels;
    let tabModels = allModels.filter((model) => Boolean(model.isLimited) === (activeTab === 'limited'));

    if (activeTab === 'limited' && limitedSubFilter !== 'all') {
      tabModels = tabModels.filter((m) => (m.limitedType || 'other') === limitedSubFilter);
    }

    const filterConfig: FilterConfig = {};
    if (debouncedKeyword) filterConfig.keyword = debouncedKeyword;
    if (releaseDateFrom) filterConfig.releaseDateFrom = releaseDateFrom;
    if (releaseDateTo) filterConfig.releaseDateTo = releaseDateTo;
    const nFrom = parseInt(numberFrom, 10);
    const nTo = parseInt(numberTo, 10);
    if (!isNaN(nFrom)) filterConfig.numberFrom = nFrom;
    if (!isNaN(nTo)) filterConfig.numberTo = nTo;

    const filtered = filterModels(tabModels, filterConfig);
    const sortConfig = parseSortValue(sortValue);
    const processed = sortModels(filtered, sortConfig);
    this._processedModels = processed;

    this.setData({
      processedModels: processed.slice(0, PAGE_SIZE),
      resultCount: processed.length,
    });
  },

});
