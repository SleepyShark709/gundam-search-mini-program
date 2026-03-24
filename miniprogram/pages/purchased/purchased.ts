import { getAllModels } from '../../utils/model-service';
import { getPurchases, getPurchaseRecord, addPurchase, updatePurchase, loadPurchases } from '../../utils/purchase-service';
import { isInWishlist, toggleWishlist } from '../../utils/cloud-favorites';
import type { GundamModel, PurchaseRecord } from '../../utils/types';

Page({
  data: {
    allModels: [] as GundamModel[],
    purchasedModels: [] as GundamModel[],
    loading: true,
    statusBarHeight: 20,
    safeAreaBottom: 0,
    selectedModel: null as GundamModel | null,
    detailOpen: false,
    selectedIsWishlist: false,
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
    const allModels = getAllModels();
    this.setData({
      allModels,
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
    const purchaseIds = purchases.map(p => p.modelId);
    const purchasedModels = this.data.allModels.filter((m) => purchaseIds.includes(m.id));
    this.setData({ purchasedModels, loading: false });
  },

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
    });
  },

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
    if (existing) {
      await updatePurchase(data.modelId, data);
    } else {
      await addPurchase(data);
    }
    this.setData({ formOpen: false });
    this.refreshList();
    wx.showToast({ title: '保存成功', icon: 'success' });
  },
});
