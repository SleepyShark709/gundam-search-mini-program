import { canShareKind, featureRevision, getFeatures, isFeatureEnabled } from '../../utils/feature-flags';
import { bindPageFeatures, isCurrentPage, unbindPageFeatures } from '../../utils/feature-page';
import { getAllModels, refreshMissingModels } from '../../utils/model-service';
import { createShare, getShare } from '../../utils/hangar-service';
import { loadSquadDraft, saveSquadDraft } from '../../utils/squad-draft';
import { generateSquadPoster } from '../../utils/hangar-poster';
import type { GundamModel } from '../../utils/types';

Page({
  _revision: 0,
  _unloaded: false,
  _initialized: false,
  _initializing: null as Promise<void> | null,
  _shareId: '',
  data: {
    features: getFeatures(),
    featureEnabled: false,
    title: '我的六机出击',
    modelIds: [] as string[],
    models: [] as GundamModel[],
    captainId: '',
    slots: [1, 2, 3, 4, 5, 6],
    preparedId: '',
    preparing: false,
    shareError: '',
    loading: false,
    loadError: '',
    posterPath: '',
    posterLoading: false,
    posterError: '',
    safeAreaBottom: 0,
  },

  onLoad(options: Record<string, string | undefined>) {
    this._shareId = options.shareId || '';
    bindPageFeatures(this, 'squad', (enabled, features) => {
      enabled = enabled && (!this._shareId || features.sharing);
      this.setData({ featureEnabled: enabled });
      if (enabled) { void this.initialize(); return; }
      this._revision++;
      if (isCurrentPage(this)) wx.hideShareMenu();
      this._initializing = null;
      this.setData({ preparedId: '', preparing: false, shareError: '', loading: false, loadError: '', posterLoading: false });
    });
    return this._initializing || Promise.resolve();
  },
  initialize(): Promise<void> {
    if (this._initialized || this._initializing || !isFeatureEnabled('squad')) return this._initializing || Promise.resolve();
    const revision = this._revision;
    this._initializing = this.restoreDraft().then(() => {
      if (!this._unloaded && revision === this._revision && isFeatureEnabled('squad')) this._initialized = true;
    }).finally(() => { if (revision === this._revision) this._initializing = null; });
    return this._initializing;
  },
  async restoreDraft() {
    this.setData({ safeAreaBottom: getApp<IAppOption>().globalData.safeAreaBottom });
    if (isCurrentPage(this)) wx.hideShareMenu();
    if (this._shareId) { await this.loadSharedSquad(); return; }
    const { draft, error } = loadSquadDraft();
    if (error) wx.showToast({ title: '草稿读取失败，已使用空编队', icon: 'none' });
    if (!draft) return;
    this.setData({ loading: true });
    const revision = this._revision;
    const epoch = featureRevision();
    let catalog = getAllModels();
    try { catalog = await refreshMissingModels(draft.modelIds); } catch { /* 使用本地目录 */ }
    if (this._unloaded || epoch !== featureRevision() || !isFeatureEnabled('squad')) return;
    if (revision !== this._revision) { this.setData({ loading: false }); return; }
    const models = draft.modelIds.map((id) => catalog.find((model) => model.id === id)).filter((model): model is GundamModel => !!model);
    const ids = models.map((model) => model.id);
    this.setData({ title: draft.title, modelIds: ids, models, captainId: ids.includes(draft.captainId) ? draft.captainId : ids[0] || '', loading: false });
    if (ids.length !== draft.modelIds.length) wx.showToast({ title: '部分草稿机体暂不可用，请重新选择', icon: 'none' });
  },

  onShow() {
    if (!isCurrentPage(this)) return;
    if (canShareKind('squad') && !!this.data.preparedId) wx.showShareMenu({ menus: ['shareAppMessage'] });
    else wx.hideShareMenu();
  },
  onUnload() { this._unloaded = true; unbindPageFeatures(this); },

  async loadSharedSquad() {
    if (!isFeatureEnabled('squad') || !canShareKind('squad')) return;
    const revision = this._revision;
    this.setData({ loading: true, loadError: '' });
    try {
      const snapshot = await getShare(this._shareId);
      if (snapshot.kind !== 'squad' || !snapshot.models.length || snapshot.models.length > 6) throw new Error('编队无效');
      if (this._unloaded || revision !== this._revision || !isFeatureEnabled('squad')) return;
      const ids = snapshot.models.map((model) => model.id);
      this.setData({ title: snapshot.title.slice(0, 30), models: snapshot.models, modelIds: ids, captainId: snapshot.captainId && ids.includes(snapshot.captainId) ? snapshot.captainId : ids[0] });
      this.persistDraft();
    } catch {
      if (!this._unloaded && revision === this._revision && isFeatureEnabled('squad')) this.setData({ loadError: '无法复制此编队，链接可能失效，请重试' });
    } finally {
      if (!this._unloaded && revision === this._revision && isFeatureEnabled('squad')) this.setData({ loading: false });
    }
  },

  invalidateShare() {
    this._revision += 1;
    this.setData({ preparedId: '', shareError: '', posterPath: '', posterError: '' });
    if (isCurrentPage(this)) wx.hideShareMenu();
  },

  persistDraft(): boolean {
    if (!isFeatureEnabled('squad')) return false;
    const saved = saveSquadDraft({ version: 1, title: this.data.title, modelIds: this.data.modelIds, captainId: this.data.captainId });
    if (!saved) wx.showToast({ title: '草稿保存失败，请检查存储空间后重试', icon: 'none' });
    return saved;
  },

  handleSaveDraft() {
    if (!isFeatureEnabled('squad')) return;
    if (this.persistDraft()) wx.showToast({ title: '草稿已保存', icon: 'success' });
  },

  handleTitle(e: WechatMiniprogram.Input) {
    if (!isFeatureEnabled('squad')) return;
    this.invalidateShare();
    this.setData({ title: e.detail.value.slice(0, 30) });
    this.persistDraft();
  },

  handleSelection(e: WechatMiniprogram.CustomEvent<{ ids: string[]; models: GundamModel[] }>) {
    if (!isFeatureEnabled('squad')) return;
    const models = e.detail.models;
    const ids = e.detail.ids;
    if (ids.length > 6 || new Set(ids).size !== ids.length || models.length !== ids.length) {
      wx.showToast({ title: '编队最多容纳 6 台机体', icon: 'none' });
      return;
    }
    this.invalidateShare();
    this.setData({ models, modelIds: ids, captainId: ids.includes(this.data.captainId) ? this.data.captainId : ids[0] || '' });
    this.persistDraft();
  },

  handleCaptain(e: WechatMiniprogram.TouchEvent) {
    if (!isFeatureEnabled('squad')) return;
    const id = e.currentTarget.dataset.id as string;
    if (!this.data.modelIds.includes(id) || id === this.data.captainId) return;
    this.invalidateShare();
    this.setData({ captainId: id });
    this.persistDraft();
  },

  handleRemove(e: WechatMiniprogram.TouchEvent) {
    if (!isFeatureEnabled('squad')) return;
    const id = e.currentTarget.dataset.id as string;
    const models = this.data.models.filter((model) => model.id !== id);
    this.handleSelection({ detail: { ids: models.map((model) => model.id), models } } as WechatMiniprogram.CustomEvent<{ ids: string[]; models: GundamModel[] }>);
  },

  async handlePrepareShare() {
    if (!canShareKind('squad')) return;
    const epoch = featureRevision();
    if (this.data.preparing) return;
    if (!this.data.models.length || !this.data.title.trim()) {
      wx.showToast({ title: '请填写编队名并选择至少 1 台机体', icon: 'none' });
      return;
    }
    const revision = this._revision;
    this.setData({ preparing: true, shareError: '' });
    try {
      const result = await createShare({ kind: 'squad', title: this.data.title.trim(), modelIds: this.data.modelIds.slice(), captainId: this.data.captainId });
      if (this._unloaded || revision !== this._revision || epoch !== featureRevision() || !canShareKind('squad')) return;
      this.setData({ preparedId: result.id });
      if (isCurrentPage(this)) wx.showShareMenu({ menus: ['shareAppMessage'] });
    } catch {
      if (!this._unloaded && revision === this._revision && epoch === featureRevision() && canShareKind('squad')) this.setData({ shareError: '分享准备失败，请重试' });
    } finally {
      if (!this._unloaded && epoch === featureRevision()) this.setData({ preparing: false });
    }
  },

  onShareAppMessage() {
    if (!isFeatureEnabled('squad')) return { title: '高达模型目录', path: '/pages/home/home' };
    return { title: this.data.title.trim() || '我的六机出击', path: canShareKind('squad') && this.data.preparedId ? `/pages/share/share?id=${encodeURIComponent(this.data.preparedId)}` : '/pages/squad/squad' };
  },

  async handlePoster() {
    if (!isFeatureEnabled('squad')) return;
    if (this.data.posterLoading) return;
    if (!this.data.models.length) { wx.showToast({ title: '先选择至少 1 台机体', icon: 'none' }); return; }
    const revision = this._revision;
    this.setData({ posterLoading: true, posterError: '' });
    try {
      const path = await generateSquadPoster(this, this.data.title.trim(), this.data.models, this.data.captainId);
      if (!this._unloaded && revision === this._revision && isFeatureEnabled('squad')) this.setData({ posterPath: path });
    } catch {
      if (!this._unloaded && revision === this._revision && isFeatureEnabled('squad')) this.setData({ posterError: '海报生成失败，请重试' });
    } finally {
      if (!this._unloaded) this.setData({ posterLoading: false });
    }
  },
  handlePreviewPoster() {
    if (!isFeatureEnabled('squad')) return;
    if (this.data.posterPath) wx.previewImage({ urls: [this.data.posterPath] });
  },
  handleSharePoster() {
    if (!isFeatureEnabled('squad')) return;
    if (!this.data.posterPath) return;
    wx.showShareImageMenu({ path: this.data.posterPath, fail: () => wx.showToast({ title: '图片分享未完成，可预览或保存后发送', icon: 'none' }) });
  },
  handleSavePoster() {
    if (!isFeatureEnabled('squad')) return;
    if (!this.data.posterPath) return;
    wx.saveImageToPhotosAlbum({ filePath: this.data.posterPath, success: () => wx.showToast({ title: '已保存到相册', icon: 'success' }), fail: () => wx.showToast({ title: '保存失败，请检查相册权限后重试', icon: 'none' }) });
  },
  handleQuiz() {
    if (!isFeatureEnabled('squad') || !isFeatureEnabled('quiz')) return;
    if (this.persistDraft()) wx.navigateTo({ url: '/pages/quiz/quiz' });
  },
  handleBack() { wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/home/home' }) }); },
});
