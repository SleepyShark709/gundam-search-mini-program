import { getSeriesMeta, refreshSeriesMeta } from '../../utils/model-service';
import { migrateFavoritesIfNeeded } from '../../utils/favorites';

Page({
  data: {
    series: [] as any[],
    loading: true,
    statusBarHeight: 20,
    activeIndex: 0,
    scrollLeft: 0,
    itemWidth: 0,
  },
  _touchStartX: 0,
  _touchStartTime: 0,
  onLoad() {
    const app = getApp<IAppOption>();
    const series = getSeriesMeta();
    migrateFavoritesIfNeeded();

    const windowWidth = app.globalData.windowWidth;
    const itemWidth = windowWidth - 170 * windowWidth / 750;

    this.setData({
      series,
      loading: false,
      statusBarHeight: app.globalData.statusBarHeight,
      itemWidth,
    });

    // 异步从服务器刷新系列元信息（5s 超时后降级为本地数据）
    refreshSeriesMeta().then((newMeta) => {
      if (newMeta.length > 0) {
        this.setData({ series: newMeta });
      }
    });
  },
  handleTouchStart(e: any) {
    this._touchStartX = e.touches[0].clientX;
    this._touchStartTime = Date.now();
  },
  handleTouchEnd(e: any) {
    const dx = e.changedTouches[0].clientX - this._touchStartX;
    const dt = Date.now() - this._touchStartTime;

    const threshold = 30;
    const isQuickSwipe = dt < 300 && Math.abs(dx) > 15;

    if (dx < -threshold || (isQuickSwipe && dx < 0)) {
      this.goTo(this.data.activeIndex + 1);
    } else if (dx > threshold || (isQuickSwipe && dx > 0)) {
      this.goTo(this.data.activeIndex - 1);
    } else {
      // 回弹：先设为 -1 强制刷新，再设回正确位置
      this.setData({ scrollLeft: -1 });
      setTimeout(() => this.goTo(this.data.activeIndex), 50);
    }
  },
  goTo(index: number) {
    const clamped = Math.max(0, Math.min(index, this.data.series.length - 1));
    this.setData({
      activeIndex: clamped,
      scrollLeft: clamped * this.data.itemWidth,
    });
  },
  scrollToIndex(e: any) {
    const index = e.currentTarget.dataset.index;
    this.goTo(index);
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
});
