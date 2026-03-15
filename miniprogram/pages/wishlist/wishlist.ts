import { getAllModels } from '../../utils/model-service';
import { getWishlist, isInWishlist, toggleWishlist } from '../../utils/cloud-favorites';
import { isPurchased, addPurchase, updatePurchase, getPurchaseRecord } from '../../utils/purchase-service';
import type { GundamModel } from '../../utils/types';

Page({
  data: {
    allModels: [] as GundamModel[],
    wishlistModels: [] as GundamModel[],
    loading: true,
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
    const allModels = getAllModels();
    this.setData({
      allModels,
      statusBarHeight: app.globalData.statusBarHeight,
      exchangeRate: app.globalData.exchangeRate || 0.05,
      safeAreaBottom: app.globalData.safeAreaBottom,
    });
  },

  onShow() {
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
  },

  refreshList() {
    const wishlistIds = getWishlist();
    const wishlistModels = this.data.allModels.filter((m) => wishlistIds.includes(m.id));
    this.setData({ wishlistModels, loading: false });
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
    const nowInWishlist = await toggleWishlist(id);
    this.refreshList();
    if (this.data.selectedModel && this.data.selectedModel.id === id) {
      this.setData({ selectedIsWishlist: nowInWishlist });
    }
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
      if (existing) {
        await updatePurchase(data.modelId, data);
      } else {
        await addPurchase(data);
      }
      this.setData({ formOpen: false, selectedIsPurchased: true });
      wx.showToast({ title: '保存成功', icon: 'success' });
    } catch (err) {
      wx.showToast({ title: '保存失败', icon: 'none' });
    }
  },
});
