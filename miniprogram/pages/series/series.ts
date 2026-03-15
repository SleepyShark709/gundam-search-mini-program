import { getModels, filterModels, sortModels } from '../../utils/model-service';
import { getWishlist, isInWishlist, toggleWishlist } from '../../utils/cloud-favorites';
import { isPurchased, getPurchaseRecord, addPurchase, updatePurchase } from '../../utils/purchase-service';
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

let debounceTimer: number | null = null;

Page({
  data: {
    seriesCode: 'hg' as string,
    seriesTitle: '',
    allModels: [] as GundamModel[],
    regularModels: [] as GundamModel[],
    limitedModels: [] as GundamModel[],
    processedModels: [] as GundamModel[],
    favorites: [] as string[],
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

    const allModels = getModels(code);
    const regularModels = allModels.filter((m) => !m.isLimited);
    const limitedModels = allModels.filter((m) => m.isLimited);

    this.setData({
      seriesCode: code,
      seriesTitle: SERIES_NAMES[code] || code.toUpperCase(),
      allModels,
      regularModels,
      limitedModels,
      statusBarHeight: app.globalData.statusBarHeight,
      loading: false,
      exchangeRate: app.globalData.exchangeRate || 0.05,
      safeAreaBottom: app.globalData.safeAreaBottom,
    });

    this.applyFilters();
  },

  onShow() {
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
    this.setData({ favorites, favMap });
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

    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      this.setData({ debouncedKeyword: value });
      this.applyFilters();
    }, 300) as unknown as number;
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
    const nowFav = await toggleWishlist(id);
    this._refreshFavMap();
    if (this.data.selectedModel && this.data.selectedModel.id === id) {
      this.setData({ selectedIsFav: nowFav });
    }
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
      if (existing) {
        await updatePurchase(data.modelId, data);
      } else {
        await addPurchase(data);
      }
      this.setData({ formOpen: false, selectedIsPurchased: true });
      this._refreshFavMap();
      wx.showToast({ title: '保存成功', icon: 'success' });
    } catch (err) {
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

  // Apply all filters and sorting
  applyFilters() {
    const { activeTab, regularModels, limitedModels, limitedSubFilter, debouncedKeyword, releaseDateFrom, releaseDateTo, numberFrom, numberTo, sortValue } = this.data;

    let tabModels = activeTab === 'regular' ? regularModels : limitedModels;

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

    this.setData({
      processedModels: processed,
      resultCount: processed.length,
    });
  },

});
