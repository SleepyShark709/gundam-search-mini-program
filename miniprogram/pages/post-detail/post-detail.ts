import {
  getPostDetail,
  createReply,
  deleteReply,
  deletePost,
  ForumPost,
  ForumReply,
} from '../../utils/forum-service';
import { getCurrentOpenid, isCurrentUserAdmin, isLoggedIn } from '../../utils/user-service';
import { formatRelativeTime } from '../../utils/time';

interface DisplayReply extends ForumReply {
  timeText: string;
  canDelete: boolean;
}

interface DisplayPost extends ForumPost {
  timeText: string;
  canDelete: boolean;
}

const CONTENT_MAX = 5000;

function decoratePost(post: ForumPost): DisplayPost {
  const myOpenid = getCurrentOpenid();
  const admin = isCurrentUserAdmin();
  return {
    ...post,
    timeText: formatRelativeTime(post.createdAt),
    canDelete: admin || (!!myOpenid && post.authorOpenid === myOpenid),
  };
}

function decorateReplies(replies: ForumReply[]): DisplayReply[] {
  const myOpenid = getCurrentOpenid();
  const admin = isCurrentUserAdmin();
  return replies.map((r) => ({
    ...r,
    timeText: formatRelativeTime(r.createdAt),
    canDelete: admin || (!!myOpenid && r.authorOpenid === myOpenid),
  }));
}

Page({
  data: {
    safeAreaBottom: 0,
    postId: '',
    post: null as DisplayPost | null,
    replies: [] as DisplayReply[],
    loading: true,
    notFound: false,
    replyContent: '',
    submitting: false,
    isLoggedIn: false,
    contentMax: CONTENT_MAX,
  },

  onLoad(options: any) {
    const app = getApp<IAppOption>();
    this.setData({
      safeAreaBottom: app.globalData.safeAreaBottom,
      postId: options.id || '',
      isLoggedIn: isLoggedIn(),
    });
    this.fetchDetail();
  },

  async fetchDetail() {
    const detail = await getPostDetail(this.data.postId);
    if (!detail) {
      this.setData({ loading: false, notFound: true });
      return;
    }
    this.setData({
      post: decoratePost(detail.post),
      replies: decorateReplies(detail.replies),
      loading: false,
    });
  },

  handleBack() {
    wx.navigateBack();
  },

  onReplyInput(e: any) {
    this.setData({ replyContent: e.detail.value });
  },

  async submitReply() {
    if (!this.data.isLoggedIn) {
      wx.showModal({
        title: '请先设置昵称',
        content: '回复需要先在"我的"中设置昵称和头像',
        confirmText: '去设置',
        success: (res) => {
          if (res.confirm) {
            wx.switchTab({ url: '/pages/profile/profile' });
          }
        },
      });
      return;
    }

    const content = this.data.replyContent.trim();
    if (!content || this.data.submitting) return;

    this.setData({ submitting: true });
    const result = await createReply(this.data.postId, content);
    this.setData({ submitting: false });

    if (result.ok) {
      this.setData({ replyContent: '' });
      wx.showToast({ title: '已回复', icon: 'success' });
      this.fetchDetail();
    } else {
      wx.showToast({ title: result.error, icon: 'none' });
    }
  },

  handleDeletePost() {
    wx.showModal({
      title: '删除帖子',
      content: '删除后帖子和回复都将无法恢复',
      confirmText: '删除',
      confirmColor: '#ff3366',
      success: async (res) => {
        if (!res.confirm) return;
        const ok = await deletePost(this.data.postId);
        if (ok) {
          wx.showToast({ title: '已删除', icon: 'success' });
          setTimeout(() => wx.navigateBack(), 500);
        } else {
          wx.showToast({ title: '删除失败', icon: 'none' });
        }
      },
    });
  },

  handleDeleteReply(e: any) {
    const replyId = e.currentTarget.dataset.id;
    wx.showModal({
      title: '删除回复',
      content: '删除后无法恢复',
      confirmText: '删除',
      confirmColor: '#ff3366',
      success: async (res) => {
        if (!res.confirm) return;
        const ok = await deleteReply(replyId, this.data.postId);
        if (ok) {
          this.setData({
            replies: this.data.replies.filter((r) => r.id !== replyId),
          });
        } else {
          wx.showToast({ title: '删除失败', icon: 'none' });
        }
      },
    });
  },

  onShareAppMessage() {
    return {
      title: this.data.post?.title || '高达模型论坛',
      path: `/pages/post-detail/post-detail?id=${this.data.postId}`,
    };
  },
});
