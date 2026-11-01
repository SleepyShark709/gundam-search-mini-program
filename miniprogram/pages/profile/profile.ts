import { getFeatures, isFeatureEnabled, FeatureKey } from '../../utils/feature-flags';
import { bindPageFeatures, unbindPageFeatures } from '../../utils/feature-page';
import { getWishlist, loadWishlist } from '../../utils/cloud-favorites';
import { getPurchases, loadPurchases } from '../../utils/purchase-service';
import { getUserInfo, updateUserProfile } from '../../utils/user-service';
import { ensureCloudInit } from '../../utils/api';

const OLD_AVATAR_KEY = 'gundam-user-avatar';

Page({
  _loading: null as Promise<void> | null,
  _unloaded: false,
  _avatarEdited: false,
  _nicknameEdited: false,

  data: {
    features: getFeatures(),
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
    hasUserInfo: false,
    userLoading: true,
    userLoadError: false,
  },

  onLoad() {
    const app = getApp<IAppOption>();
    this.setData({
      statusBarHeight: app.globalData.statusBarHeight,
      safeAreaBottom: app.globalData.safeAreaBottom,
    });
    bindPageFeatures(this);
    this.renderUserInfo();
  },

  onShow() {
    bindPageFeatures(this);
    return this.loadData();
  },

  onUnload() {
    this._unloaded = true;
    unbindPageFeatures(this);
  },

  handleRetry() {
    return this.loadData();
  },

  loadData(): Promise<void> {
    if (this._loading) return this._loading;
    if (this._unloaded) return Promise.resolve();
    this.setData({ userLoading: true, userLoadError: false });
    this._loading = Promise.allSettled([loadWishlist(), loadPurchases(), this.syncUserInfo()]).then(() => {
      if (this._unloaded) return;
      this.setData({
        wishlistCount: getWishlist().length,
        purchasedCount: getPurchases().length,
      });
    }).finally(() => {
      this._loading = null;
      if (!this._unloaded) this.setData({ userLoading: false });
    });
    return this._loading;
  },

  async syncUserInfo() {
    const app = getApp<IAppOption>();
    let success = false;
    try {
      await app.loadUserInfo();
      success = app.globalData.userInfoLoaded;
    } catch (_) {}
    if (this._unloaded) return;
    this.renderUserInfo();
    this.setData({ userLoadError: !success });
  },

  renderUserInfo() {
    const info = getUserInfo();
    const app = getApp<IAppOption>();
    app.globalData.userInfo = info;
    if (this._unloaded) return;
    this.setData({
      hasUserInfo: !!info,
      isLoggedIn: !!(info?.nickname && info.avatarUrl) && !this._avatarEdited && !this._nicknameEdited,
      avatarUrl: info?.avatarUrl || '',
      nickname: info?.nickname || '',
      tempAvatarUrl: this._avatarEdited ? this.data.tempAvatarUrl : info?.avatarUrl || '',
      tempNickname: this._nicknameEdited ? this.data.tempNickname : info?.nickname || '',
    });
  },

  onChooseAvatar(e: any) {
    const url = e.detail.avatarUrl;
    if (url) {
      this._avatarEdited = true;
      this.setData({ tempAvatarUrl: url });
    }
  },

  onNicknameChange(e: any) {
    this._nicknameEdited = true;
    this.setData({ tempNickname: e.detail.value || '' });
  },

  async saveProfile() {
    const { tempAvatarUrl, tempNickname, saving } = this.data;
    if (this._unloaded || saving || !tempAvatarUrl || !tempNickname) return;

    this.setData({ saving: true });
    wx.showLoading({ title: '保存中', mask: true });

    try {
      let avatarFileId = tempAvatarUrl;
      if (!avatarFileId.startsWith('cloud://')) {
        ensureCloudInit();
        const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const uploadRes = await wx.cloud.uploadFile({
          cloudPath: `avatars/${suffix}.jpg`,
          filePath: tempAvatarUrl,
        });
        avatarFileId = uploadRes.fileID;
      }
      if (this._unloaded) return;

      const result = await updateUserProfile({
        nickname: tempNickname,
        avatarFileId,
      });

      if (result) {
        const app = getApp<IAppOption>();
        app.globalData.userInfoLoaded = true;
        this._avatarEdited = false;
        this._nicknameEdited = false;
        try { wx.removeStorageSync(OLD_AVATAR_KEY); } catch (_) {}
      }
      this.renderUserInfo();
      if (this._unloaded) return;
      if (result) {
        this.setData({ userLoadError: false });
        wx.showToast({ title: '保存成功', icon: 'success' });
      } else {
        wx.showToast({ title: '保存失败', icon: 'none' });
      }
    } catch (e: any) {
      console.error('保存用户信息失败', e);
      this.renderUserInfo();
      if (this._unloaded) return;
      const errMsg = e?.errMsg || '';
      wx.showToast({
        title: errMsg.includes('cloud') || errMsg.includes('upload') ? '头像上传失败' : '保存失败',
        icon: 'none',
      });
    } finally {
      wx.hideLoading();
      if (!this._unloaded) this.setData({ saving: false });
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

  handleHangar(e: WechatMiniprogram.TouchEvent) {
    const page = e.currentTarget.dataset.page as string;
    if (['squad', 'quiz', 'builds'].includes(page) && isFeatureEnabled(page as FeatureKey)) wx.navigateTo({ url: `/pages/${page}/${page}` });
  },

  handleWishlist() {
    wx.navigateTo({ url: '/pages/wishlist/wishlist' });
  },

  handlePurchased() {
    wx.navigateTo({ url: '/pages/purchased/purchased' });
  },
});
