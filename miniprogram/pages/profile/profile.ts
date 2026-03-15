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
  onChooseAvatar(e: any) {
    const url = e.detail.avatarUrl;
    if (url) {
      this.setData({ avatarUrl: url });
      wx.setStorageSync(AVATAR_KEY, url);
    }
  },
  handleWishlist() {
    wx.navigateTo({ url: '/pages/wishlist/wishlist' });
  },
  handlePurchased() {
    wx.navigateTo({ url: '/pages/purchased/purchased' });
  },
});
