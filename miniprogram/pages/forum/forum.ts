import {
  loadPosts,
  loadMore,
  getPosts,
  hasMore,
  isPostsLoaded,
  deletePost,
  ForumPost,
} from '../../utils/forum-service';
import { getCurrentOpenid, isCurrentUserAdmin, isLoggedIn } from '../../utils/user-service';
import { formatRelativeTime } from '../../utils/time';

interface DisplayPost extends ForumPost {
  timeText: string;
  preview: string;
  canDelete: boolean;
}

function decorate(posts: ForumPost[]): DisplayPost[] {
  const myOpenid = getCurrentOpenid();
  const admin = isCurrentUserAdmin();
  return posts.map((p) => ({
    ...p,
    timeText: formatRelativeTime(p.createdAt),
    preview: p.content.length > 80 ? p.content.slice(0, 80) + '...' : p.content,
    canDelete: admin || (!!myOpenid && p.authorOpenid === myOpenid),
  }));
}

Page({
  data: {
    statusBarHeight: 20,
    safeAreaBottom: 0,
    posts: [] as DisplayPost[],
    loading: true,
    loadingMore: false,
    hasMore: false,
    isLoggedIn: false,
  },

  onLoad() {
    const app = getApp<IAppOption>();
    this.setData({
      statusBarHeight: app.globalData.statusBarHeight,
      safeAreaBottom: app.globalData.safeAreaBottom,
    });
  },

  async onShow() {
    const app = getApp<IAppOption>();
    if (!app.globalData.userInfoLoaded) {
      await app.loadUserInfo();
    }
    this.setData({ isLoggedIn: isLoggedIn() });

    // 已加载过则直接渲染缓存，再后台刷新
    if (isPostsLoaded()) {
      this.setData({ posts: decorate(getPosts()), hasMore: hasMore(), loading: false });
    }
    await loadPosts(true);
    this.setData({
      posts: decorate(getPosts()),
      hasMore: hasMore(),
      loading: false,
    });
  },

  async onPullDownRefresh() {
    await loadPosts(true);
    this.setData({
      posts: decorate(getPosts()),
      hasMore: hasMore(),
    });
    wx.stopPullDownRefresh();
  },

  async handleScrollToLower() {
    if (this.data.loadingMore || !this.data.hasMore) return;
    this.setData({ loadingMore: true });
    await loadMore();
    this.setData({
      posts: decorate(getPosts()),
      hasMore: hasMore(),
      loadingMore: false,
    });
  },

  handleCreate() {
    if (!this.data.isLoggedIn) {
      wx.showModal({
        title: '请先设置昵称',
        content: '发帖需要先在"我的"中设置昵称和头像',
        confirmText: '去设置',
        success: (res) => {
          if (res.confirm) {
            wx.switchTab({ url: '/pages/profile/profile' });
          }
        },
      });
      return;
    }
    wx.navigateTo({ url: '/pages/post-create/post-create' });
  },

  handlePostTap(e: any) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: `/pages/post-detail/post-detail?id=${id}` });
  },

  handleDeletePost(e: any) {
    const id = e.currentTarget.dataset.id;
    wx.showModal({
      title: '删除帖子',
      content: '删除后帖子和回复都将无法恢复',
      confirmText: '删除',
      confirmColor: '#ff3366',
      success: async (res) => {
        if (!res.confirm) return;
        const ok = await deletePost(id);
        if (ok) {
          this.setData({ posts: decorate(getPosts()), hasMore: hasMore() });
          wx.showToast({ title: '已删除', icon: 'success' });
        } else {
          wx.showToast({ title: '删除失败', icon: 'none' });
        }
      },
    });
  },

  onShareAppMessage() {
    return {
      title: '高达模型论坛',
      path: '/pages/forum/forum',
    };
  },

  onShareTimeline() {
    return {
      title: '高达模型目录 - 万代高达塑料模型大全',
    };
  },
});
