import { getAllModels, refreshMissingModels } from '../../utils/model-service';
import { loadWishlist, getWishlist, isInWishlist, toggleWishlist } from '../../utils/cloud-favorites';
import { isPurchased, addPurchase, updatePurchase, getPurchaseRecord, loadPurchases } from '../../utils/purchase-service';
import type { GundamModel } from '../../utils/types';

interface WishlistItem {
  id: string;
  model: GundamModel | null;
}

const PAGE_SIZE = 40;

Page({
  _allModels: [] as GundamModel[],
  _wishlistItems: [] as WishlistItem[],
  _loading: null as Promise<void> | null,
  _unloaded: false,

  data: {
    wishlistItems: [] as WishlistItem[],
    totalCount: 0,
    loading: true,
    shareModelIds: [] as string[],
    publicShareId: '',
    loadError: false,
    statusBarHeight: 20,
    safeAreaBottom: 0,
    selectedModel: null as GundamModel | null,
    detailOpen: false,
    selectedIsWishlist: false,
    selectedIsPurchased: false,
    exchangeRate: 0.05,
    // Purchase form
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
    this.setData({
      statusBarHeight: app.globalData.statusBarHeight,
      exchangeRate: app.globalData.exchangeRate || 0.05,
      safeAreaBottom: app.globalData.safeAreaBottom,
    });
    this.refreshList();
  },

  onShow() {
    return this.loadData();
  },

  onUnload() {
    this._unloaded = true;
  },

  handleRetry() {
    return this.loadData();
  },

  loadData(): Promise<void> {
    if (this._loading) return this._loading;
    if (this._unloaded) return Promise.resolve();
    this.setData({ loading: true, loadError: false });
    this._loading = Promise.allSettled([loadWishlist(), loadPurchases()]).then(async ([wishlistResult]) => {
      if (this._unloaded) return;
      if (wishlistResult.status !== 'fulfilled' || !wishlistResult.value) {
        this.setData({ loadError: true });
        return;
      }
      try {
        this._allModels = await refreshMissingModels(getWishlist());
      } catch {
        this._allModels = getAllModels();
      }
      if (this._unloaded) return;
      this.refreshList();
      if (this.data.selectedModel) {
        this.setData({
          selectedIsWishlist: isInWishlist(this.data.selectedModel.id),
          selectedIsPurchased: isPurchased(this.data.selectedModel.id),
        });
      }
      const app = getApp<IAppOption>();
      if (app.globalData.exchangeRate) {
        this.setData({ exchangeRate: app.globalData.exchangeRate });
      }
    }).finally(() => {
      this._loading = null;
      if (!this._unloaded) this.setData({ loading: false });
    });
    return this._loading;
  },

  refreshList() {
    const wishlistIds = new Set(getWishlist());
    const wishlistItems: WishlistItem[] = [];
    for (const model of this._allModels) {
      if (!wishlistIds.delete(model.id)) continue;
      wishlistItems.push({ id: model.id, model });
    }
    wishlistIds.forEach((id) => wishlistItems.push({ id, model: null }));
    this._wishlistItems = wishlistItems;
    const count = Math.max(PAGE_SIZE, this.data.wishlistItems.length);
    this.setData({ wishlistItems: wishlistItems.slice(0, count), totalCount: wishlistItems.length,
      shareModelIds: wishlistItems.filter((item) => item.model).map((item) => item.id), publicShareId: '' });
  },

  handleLoadMore() {
    if (this.data.wishlistItems.length >= this._wishlistItems.length) return;
    const count = this.data.wishlistItems.length + PAGE_SIZE;
    this.setData({ wishlistItems: this._wishlistItems.slice(0, count) });
  },

  handleRemoveMissing(e: WechatMiniprogram.TouchEvent) {
    return this.handleToggleWishlist({ detail: { id: e.currentTarget.dataset.id as string } });
  },

  handleSharePrepared(e: WechatMiniprogram.CustomEvent<{ id: string }>) {
    this.setData({ publicShareId: e.detail.id });
  },

  onShareAppMessage() {
    return {
      title: this.data.publicShareId ? '我的高达心愿单' : '高达模型目录',
      path: this.data.publicShareId ? `/pages/share/share?id=${this.data.publicShareId}` : '/pages/home/home',
    };
  },

  onShareTimeline() {
    return {
      title: '高达模型目录 - 万代高达塑料模型大全',
    };
  },

  handleBack() {
    wx.navigateBack();
  },

  handleExplore() {
    wx.switchTab({ url: '/pages/home/home' });
  },

  handleModelSelect(e: any) {
    const model = e.detail.model;
    this.setData({
      selectedModel: model,
      detailOpen: true,
      selectedIsWishlist: isInWishlist(model.id),
      selectedIsPurchased: isPurchased(model.id),
    });
  },

  handleDetailClose() {
    this.setData({ detailOpen: false });
  },

  async handleToggleWishlist(e: any) {
    const id = e.detail.id;
    const result = await toggleWishlist(id);
    this.refreshList();
    if (this.data.selectedModel && this.data.selectedModel.id === id) {
      this.setData({ selectedIsWishlist: result.isFavorite });
    }
    if (!result.success) wx.showToast({ title: '心愿单更新失败', icon: 'none' });
  },

  // Purchase
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
      const success = existing
        ? await updatePurchase(data.modelId, data)
        : await addPurchase(data);
      if (!success) {
        wx.showToast({ title: '保存失败', icon: 'none' });
        return;
      }
      this.setData({ formOpen: false, selectedIsPurchased: true });
      wx.showToast({ title: '保存成功', icon: 'success' });
    } catch (err) {
      wx.showToast({ title: '保存失败', icon: 'none' });
    }
  },
});
