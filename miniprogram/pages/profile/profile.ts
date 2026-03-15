Page({
  data: {
    statusBarHeight: 20,
    safeAreaBottom: 0,
    wishlistCount: 0,
    purchasedCount: 0,
  },
  onLoad() {
    const app = getApp<IAppOption>();
    this.setData({
      statusBarHeight: app.globalData.statusBarHeight,
      safeAreaBottom: app.globalData.safeAreaBottom,
    });
  },
  handleWishlist() {
    wx.navigateTo({ url: '/pages/wishlist/wishlist' });
  },
  handlePurchased() {
    wx.navigateTo({ url: '/pages/purchased/purchased' });
  },
});
