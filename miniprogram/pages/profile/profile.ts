import { getWishlist } from '../../utils/cloud-favorites';
import { getPurchases } from '../../utils/purchase-service';
import { getUserInfo, updateUserProfile } from '../../utils/user-service';
import { ensureCloudInit } from '../../utils/api';

const OLD_AVATAR_KEY = 'gundam-user-avatar';

Page({
  data: {
    statusBarHeight: 20,
    safeAreaBottom: 0,
    wishlistCount: 0,
    purchasedCount: 0,
    isLoggedIn: false,
    avatarUrl: '',
    nickname: '',
    tempAvatarUrl: '',
    tempNickname: '',
    saving: false,
  },

  onLoad() {
    const app = getApp<IAppOption>();
    this.setData({
      statusBarHeight: app.globalData.statusBarHeight,
      safeAreaBottom: app.globalData.safeAreaBottom,
    });
  },

  onShow() {
    this.setData({
      wishlistCount: getWishlist().length,
      purchasedCount: getPurchases().length,
    });
    this.syncUserInfo();
  },

  async syncUserInfo() {
    const app = getApp<IAppOption>();

    if (!app.globalData.userInfoLoaded) {
      await app.loadUserInfo();
    }

    const info = getUserInfo();
    if (info) {
      this.setData({
        isLoggedIn: true,
        avatarUrl: info.avatarUrl,
        nickname: info.nickname,
      });
    } else {
      const oldAvatar = wx.getStorageSync(OLD_AVATAR_KEY) || '';
      this.setData({
        isLoggedIn: false,
        avatarUrl: '',
        nickname: '',
        tempAvatarUrl: oldAvatar,
        tempNickname: '',
      });
    }
  },

  onChooseAvatar(e: any) {
    const url = e.detail.avatarUrl;
    if (url) {
      this.setData({ tempAvatarUrl: url });
    }
  },

  onNicknameChange(e: any) {
    this.setData({ tempNickname: e.detail.value || '' });
  },

  async saveProfile() {
    const { tempAvatarUrl, tempNickname, saving } = this.data;
    if (saving || !tempAvatarUrl || !tempNickname) return;

    this.setData({ saving: true });
    wx.showLoading({ title: '保存中', mask: true });

    try {
      ensureCloudInit();
      const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const uploadRes = await wx.cloud.uploadFile({
        cloudPath: `avatars/${suffix}.jpg`,
        filePath: tempAvatarUrl,
      });

      const result = await updateUserProfile({
        nickname: tempNickname,
        avatarFileId: uploadRes.fileID,
      });

      wx.hideLoading();

      if (result) {
        this.setData({
          isLoggedIn: true,
          avatarUrl: result.avatarUrl,
          nickname: result.nickname,
          saving: false,
        });
        const app = getApp<IAppOption>();
        app.globalData.userInfo = result;
        try { wx.removeStorageSync(OLD_AVATAR_KEY); } catch (_) {}
        wx.showToast({ title: '保存成功', icon: 'success' });
      } else {
        this.setData({ saving: false });
        wx.showToast({ title: '保存失败', icon: 'none' });
      }
    } catch (e: any) {
      wx.hideLoading();
      console.error('保存用户信息失败', e);
      this.setData({ saving: false });
      const errMsg = e?.errMsg || '';
      wx.showToast({
        title: errMsg.includes('cloud') || errMsg.includes('upload') ? '头像上传失败' : '保存失败',
        icon: 'none',
      });
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
