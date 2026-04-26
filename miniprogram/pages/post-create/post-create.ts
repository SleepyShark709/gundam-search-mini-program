import { createPost } from '../../utils/forum-service';

const TITLE_MAX = 120;
const CONTENT_MAX = 5000;

Page({
  data: {
    safeAreaBottom: 0,
    title: '',
    content: '',
    submitting: false,
    titleMax: TITLE_MAX,
    contentMax: CONTENT_MAX,
  },

  onLoad() {
    const app = getApp<IAppOption>();
    this.setData({ safeAreaBottom: app.globalData.safeAreaBottom });
  },

  handleBack() {
    if (this.data.title.trim() || this.data.content.trim()) {
      wx.showModal({
        title: '放弃发布？',
        content: '当前编辑的内容将丢失',
        confirmText: '放弃',
        confirmColor: '#ff3366',
        success: (res) => {
          if (res.confirm) wx.navigateBack();
        },
      });
    } else {
      wx.navigateBack();
    }
  },

  onTitleInput(e: any) {
    this.setData({ title: e.detail.value });
  },

  onContentInput(e: any) {
    this.setData({ content: e.detail.value });
  },

  async submitPost() {
    const title = this.data.title.trim();
    const content = this.data.content.trim();

    if (!title) {
      wx.showToast({ title: '请填写标题', icon: 'none' });
      return;
    }
    if (!content) {
      wx.showToast({ title: '请填写内容', icon: 'none' });
      return;
    }
    if (this.data.submitting) return;

    this.setData({ submitting: true });
    wx.showLoading({ title: '发布中', mask: true });

    const result = await createPost(title, content);

    wx.hideLoading();
    this.setData({ submitting: false });

    if (result.ok) {
      wx.showToast({ title: '发布成功', icon: 'success' });
      setTimeout(() => wx.navigateBack(), 500);
    } else {
      wx.showToast({ title: result.error, icon: 'none' });
    }
  },
});
