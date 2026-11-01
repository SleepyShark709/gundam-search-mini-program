import { canShareKind, featureRevision } from '../../utils/feature-flags';
import { bindPageFeatures, unbindPageFeatures } from '../../utils/feature-page';
import { createShare } from '../../utils/hangar-service';

Component({
  options: { pureDataPattern: /^_/ },
  properties: {
    kind: { type: String, value: 'wishlist' },
    modelIds: { type: Array, value: [] as string[] },
  },
  data: { preparing: false, featureEnabled: false, _alive: true },
  lifetimes: {
    attached() {
      this.data._alive = true;
      bindPageFeatures(this, 'sharing', (enabled) => { if (!enabled) this.setData({ preparing: false }); });
    },
    detached() { this.data._alive = false; unbindPageFeatures(this); },
  },
  methods: {
    async handlePrepare() {
      if (!canShareKind(this.data.kind) || this.data.preparing || !this.data.modelIds.length) return;
      const epoch = featureRevision();
      const modelIds = this.data.modelIds.slice(0, 50);
      const kind = this.data.kind === 'purchased' ? 'purchased' : 'wishlist';
      this.setData({ preparing: true });
      try {
        const { id } = await createShare({ kind, title: kind === 'wishlist' ? '我的高达心愿单' : '我的高达收藏', modelIds });
        if (!this.data._alive || epoch !== featureRevision() || !canShareKind(kind) || JSON.stringify(modelIds) !== JSON.stringify(this.data.modelIds.slice(0, 50))) return;
        this.triggerEvent('prepared', { id });
        wx.navigateTo({ url: `/pages/share/share?id=${encodeURIComponent(id)}` });
      } catch {
        if (this.data._alive && epoch === featureRevision() && canShareKind(kind)) wx.showToast({ title: '清单生成失败，请重试', icon: 'none' });
      } finally {
        if (this.data._alive && epoch === featureRevision()) this.setData({ preparing: false });
      }
    },
  },
});
