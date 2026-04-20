import { getSeriesMeta, refreshSeriesMeta } from '../../utils/model-service';
import { migrateFavoritesIfNeeded } from '../../utils/favorites';

Page({
  data: {
    series: [] as any[],
    loading: true,
    statusBarHeight: 20,
    activeIndex: 0,
  },
  onLoad() {
    const app = getApp<IAppOption>();
    const series = getSeriesMeta();
    migrateFavoritesIfNeeded();

    this.setData({
      series,
      loading: false,
      statusBarHeight: app.globalData.statusBarHeight,
    });

    // 异步从服务器刷新系列元信息（5s 超时后降级为本地数据）
    refreshSeriesMeta().then((newMeta) => {
      if (newMeta.length > 0) {
        this.setData({ series: newMeta });
      }
    });
  },
  handleSwiperChange(e: any) {
    this.setData({ activeIndex: e.detail.current });
  },
  scrollToIndex(e: any) {
    const index = e.currentTarget.dataset.index;
    this.setData({ activeIndex: index });
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
