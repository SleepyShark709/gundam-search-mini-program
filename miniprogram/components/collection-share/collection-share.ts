import { createShare } from '../../utils/hangar-service';

Component({
  options: { pureDataPattern: /^_/ },
  properties: {
    kind: { type: String, value: 'wishlist' },
    modelIds: { type: Array, value: [] as string[] },
  },
  data: { preparing: false, _alive: true },
  lifetimes: {
    attached() { this.data._alive = true; },
    detached() { this.data._alive = false; },
  },
  methods: {
    async handlePrepare() {
      if (this.data.preparing || !this.data.modelIds.length) return;
      const modelIds = this.data.modelIds.slice(0, 50);
      const kind = this.data.kind === 'purchased' ? 'purchased' : 'wishlist';
      this.setData({ preparing: true });
      try {
        const { id } = await createShare({ kind, title: kind === 'wishlist' ? '我的高达心愿单' : '我的高达收藏', modelIds });
        if (!this.data._alive || JSON.stringify(modelIds) !== JSON.stringify(this.data.modelIds.slice(0, 50))) return;
        this.triggerEvent('prepared', { id });
        wx.navigateTo({ url: `/pages/share/share?id=${encodeURIComponent(id)}` });
      } catch {
        if (this.data._alive) wx.showToast({ title: '清单生成失败，请重试', icon: 'none' });
      } finally {
        if (this.data._alive) this.setData({ preparing: false });
      }
    },
  },
});
