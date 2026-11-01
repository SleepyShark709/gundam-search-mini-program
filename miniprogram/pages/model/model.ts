import { getAllModels, refreshMissingModels } from '../../utils/model-service';
import { loadWishlist, isInWishlist, toggleWishlist } from '../../utils/cloud-favorites';
import { loadPurchases, getPurchaseRecord, addPurchase, updatePurchase } from '../../utils/purchase-service';
import type { GundamModel, PurchaseRecord } from '../../utils/types';

Page({
  _unloaded: false,
  _id: '',
  data: {
    model: null as GundamModel | null, loading: true, error: '', syncing: true, syncError: false,
    detailOpen: false, favorite: false, purchased: false, exchangeRate: 0.05,
    formOpen: false, formPriceCny: null as number | null, formPurchaseDate: null as string | null,
    formChannel: null as string | null, formNote: null as string | null,
  },
  onLoad(options: Record<string, string>) {
    this._id = options.id || '';
    this.setData({ exchangeRate: getApp<IAppOption>().globalData.exchangeRate || 0.05 });
    return this.loadModel();
  },
  onShow() { return this.syncPersonal(); },
  onUnload() { this._unloaded = true; },
  async loadModel() {
    if (!/^(hg|rg|mg|pg)-(?:l-)?\d{1,6}$/.test(this._id)) {
      this.setData({ loading: false, error: '模型链接无效' }); return;
    }
    const local = getAllModels().find((model) => model.id === this._id) || null;
    this.setData({ model: local, loading: !local, error: '' });
    try {
      const models = await refreshMissingModels([this._id]);
      if (this._unloaded) return;
      const model = models.find((item) => item.id === this._id) || null;
      this.setData({ model, error: model ? '' : '模型信息暂未收录，请稍后重试' });
    } catch {
      if (!this._unloaded && !local) this.setData({ error: '模型加载失败，请重试' });
    } finally {
      if (!this._unloaded) this.setData({ loading: false });
    }
  },
  async syncPersonal() {
    this.setData({ syncing: true });
    const results = await Promise.allSettled([loadWishlist(), loadPurchases()]);
    if (this._unloaded) return;
    this.setData({ syncing: false, syncError: results.some((result) => result.status !== 'fulfilled' || !result.value),
      favorite: isInWishlist(this._id), purchased: !!getPurchaseRecord(this._id) });
  },
  handleBack() { wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/home/home' }) }); },
  handleHome() { wx.switchTab({ url: '/pages/home/home' }); },
  handleDetails() { this.setData({ detailOpen: true }); },
  handleClose() { this.setData({ detailOpen: false }); },
  async handleFavorite() {
    if (this.data.syncing || this.data.syncError || !this.data.model) {
      wx.showToast({ title: '请先重试同步收藏', icon: 'none' }); return;
    }
    const result = await toggleWishlist(this._id);
    if (this._unloaded) return;
    this.setData({ favorite: result.isFavorite });
    if (!result.success) wx.showToast({ title: '心愿单更新失败', icon: 'none' });
  },
  handlePurchase() {
    if (this.data.syncing || this.data.syncError || !this.data.model) {
      wx.showToast({ title: '请先重试同步收藏', icon: 'none' }); return;
    }
    const record = getPurchaseRecord(this._id);
    this.setData({ formOpen: true, formPriceCny: record?.priceCny ?? null, formPurchaseDate: record?.purchaseDate ?? null,
      formChannel: record?.channel ?? null, formNote: record?.note ?? null });
  },
  handleFormClose() { this.setData({ formOpen: false }); },
  async handleFormSubmit(e: WechatMiniprogram.CustomEvent<Partial<PurchaseRecord>>) {
    const record = getPurchaseRecord(this._id);
    const data = { ...e.detail, modelId: this._id };
    const success = record ? await updatePurchase(this._id, data) : await addPurchase(data);
    if (this._unloaded) return;
    if (success) this.setData({ purchased: true, formOpen: false });
    wx.showToast({ title: success ? '已记录入手' : '保存失败，请重试', icon: success ? 'success' : 'none' });
  },
  onShareAppMessage() {
    return this.data.model ? { title: this.data.model.name, path: `/pages/model/model?id=${encodeURIComponent(this._id)}`, imageUrl: this.data.model.imageUrl }
      : { title: '高达模型目录', path: '/pages/home/home' };
  },
  onShareTimeline() {
    return { title: this.data.model?.name || '高达模型目录', query: `id=${encodeURIComponent(this._id)}` };
  },
});
