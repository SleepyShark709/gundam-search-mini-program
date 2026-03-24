import { getWishlist } from '../../utils/cloud-favorites';
import { getPurchases } from '../../utils/purchase-service';

const AVATAR_KEY = 'gundam-user-avatar';

Page({
  data: {
    statusBarHeight: 20,
    safeAreaBottom: 0,
    wishlistCount: 0,
    purchasedCount: 0,
    avatarUrl: '',
  },
  onLoad() {
    const app = getApp<IAppOption>();
    this.setData({
      statusBarHeight: app.globalData.statusBarHeight,
      safeAreaBottom: app.globalData.safeAreaBottom,
      avatarUrl: wx.getStorageSync(AVATAR_KEY) || '',
    });
  },
  onShow() {
    this.setData({
      wishlistCount: getWishlist().length,
      purchasedCount: getPurchases().length,
    });
  },
  onChooseAvatar(e: any) {
    const url = e.detail.avatarUrl;
    if (url) {
      this.setData({ avatarUrl: url });
      wx.setStorageSync(AVATAR_KEY, url);
    }
  },
  onShareAppMessage() {
    return {
      title: '高达模型目录 - 万代高达塑料模型大全',
      path: '/pages/home/home',
    };
  },

  onShareTimeline() {
    return {
      title: '高达模型目录 - 万代高达塑料模型大全',
    };
  },

  handleWishlist() {
    wx.navigateTo({ url: '/pages/wishlist/wishlist' });
  },
  handlePurchased() {
    wx.navigateTo({ url: '/pages/purchased/purchased' });
  },
});
