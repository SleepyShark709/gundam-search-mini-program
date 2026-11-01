import { getFeatures, isFeatureEnabled } from '../../utils/feature-flags';
import { bindPageFeatures, unbindPageFeatures } from '../../utils/feature-page';
import { getSeriesMeta, refreshSeriesMeta, getAllModels, refreshModels } from '../../utils/model-service';
import { migrateFavoritesIfNeeded } from '../../utils/favorites';
import { modelFacts, recentModels } from '../../utils/discovery';
import { SeriesCode } from '../../utils/types';

Page({
  data: {
    features: getFeatures(),
    series: [] as any[],
    recent: [] as ReturnType<typeof modelFacts>[],
    keyword: '',
    loading: true,
    statusBarHeight: 20,
    activeIndex: 0,
  },
  active: true,
  recentRevision: 0,
  onLoad() {
    const app = getApp<IAppOption>();
    this.active = true;
    migrateFavoritesIfNeeded();
    this.setData({
      series: getSeriesMeta(),
      loading: false,
      statusBarHeight: app.globalData.statusBarHeight,
    });
    refreshSeriesMeta().then((series) => {
      if (this.active && series.length) this.setData({ series });
    }).catch(() => {});
    bindPageFeatures(this, 'discovery', (enabled) => {
      this.recentRevision++;
      if (enabled) this.refreshRecent();
      else this.setData({ recent: [] });
    });
  },
  refreshRecent() {
    if (!isFeatureEnabled('discovery')) return;
    const revision = this.recentRevision;
    let models = getAllModels();
    this.setData({ recent: recentModels(models).slice(0, 4).map(modelFacts) });
    (['hg', 'rg', 'mg', 'pg'] as SeriesCode[]).forEach((code) => {
      refreshModels(code).then((refreshed) => {
        if (!this.active || !isFeatureEnabled('discovery') || revision !== this.recentRevision || !refreshed.length) return;
        models = [...models.filter((model) => model.series !== code), ...refreshed];
        this.setData({ recent: recentModels(models).slice(0, 4).map(modelFacts) });
      }).catch(() => {});
    });
  },
  onUnload() {
    this.active = false;
    unbindPageFeatures(this);
  },
  handleKeywordInput(e: WechatMiniprogram.Input) {
    this.setData({ keyword: e.detail.value });
  },
  handleSearch() {
    if (!isFeatureEnabled('discovery')) return;
    wx.navigateTo({ url: `/pages/discover/discover?mode=search&keyword=${encodeURIComponent(this.data.keyword.trim())}` });
  },
  handleEntry(e: WechatMiniprogram.TouchEvent) {
    const destinations: Record<string, string> = {
      squad: '/pages/squad/squad', quiz: '/pages/quiz/quiz', builds: '/pages/builds/builds',
      lineage: '/pages/discover/discover?mode=lineage', compare: '/pages/discover/discover?mode=compare',
      new: '/pages/discover/discover?mode=new',
    };
    const entry = e.currentTarget.dataset.entry as string;
    const key = entry === 'new' ? 'discovery' : entry;
    if (!['discovery', 'squad', 'quiz', 'builds', 'lineage', 'compare'].includes(key) || !isFeatureEnabled(key as keyof typeof this.data.features)) return;
    const url = destinations[entry];
    if (typeof url === 'string') wx.navigateTo({ url });
  },
  handleModel(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id;
    if (!isFeatureEnabled('discovery')) return;
    if (!this.data.recent.some((model) => model.id === id)) return;
    wx.navigateTo({ url: `/pages/model/model?id=${encodeURIComponent(id)}` });
  },
  handleSwiperChange(e: WechatMiniprogram.SwiperChange) {
    this.setData({ activeIndex: e.detail.current });
  },
  scrollToIndex(e: WechatMiniprogram.TouchEvent) {
    const index = Number(e.currentTarget.dataset.index);
    if (Number.isInteger(index) && index >= 0 && index < this.data.series.length) {
      this.setData({ activeIndex: index });
    }
  },
  onShareAppMessage() {
    return { title: '高达模型目录 - 万代高达塑料模型大全', path: '/pages/home/home' };
  },
  onShareTimeline() {
    return { title: '高达模型目录 - 万代高达塑料模型大全' };
  },
});
