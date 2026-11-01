import { getAllModels, refreshMissingModels } from '../../utils/model-service';
import { createShare, getShare } from '../../utils/hangar-service';
import { loadSquadDraft, saveSquadDraft } from '../../utils/squad-draft';
import { generateSquadPoster } from '../../utils/hangar-poster';
import type { GundamModel } from '../../utils/types';

Page({
  _revision: 0,
  _unloaded: false,
  _shareId: '',
  data: {
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

  async onLoad(options: Record<string, string | undefined>) {
    this.setData({ safeAreaBottom: getApp<IAppOption>().globalData.safeAreaBottom });
    wx.hideShareMenu();
    this._shareId = options.shareId || '';
    if (this._shareId) { await this.loadSharedSquad(); return; }
    const { draft, error } = loadSquadDraft();
    if (error) wx.showToast({ title: '草稿读取失败，已使用空编队', icon: 'none' });
    if (!draft) return;
    this.setData({ loading: true });
    const revision = this._revision;
    let catalog = getAllModels();
    try { catalog = await refreshMissingModels(draft.modelIds); } catch { /* 使用本地目录 */ }
    if (this._unloaded) return;
    if (revision !== this._revision) { this.setData({ loading: false }); return; }
    const models = draft.modelIds.map((id) => catalog.find((model) => model.id === id)).filter((model): model is GundamModel => !!model);
    const ids = models.map((model) => model.id);
    this.setData({ title: draft.title, modelIds: ids, models, captainId: ids.includes(draft.captainId) ? draft.captainId : ids[0] || '', loading: false });
    if (ids.length !== draft.modelIds.length) wx.showToast({ title: '部分草稿机体暂不可用，请重新选择', icon: 'none' });
  },

  onUnload() { this._unloaded = true; },

  async loadSharedSquad() {
    const revision = this._revision;
    this.setData({ loading: true, loadError: '' });
    try {
      const snapshot = await getShare(this._shareId);
      if (snapshot.kind !== 'squad' || !snapshot.models.length || snapshot.models.length > 6) throw new Error('编队无效');
      if (this._unloaded || revision !== this._revision) return;
      const ids = snapshot.models.map((model) => model.id);
      this.setData({ title: snapshot.title.slice(0, 30), models: snapshot.models, modelIds: ids, captainId: snapshot.captainId && ids.includes(snapshot.captainId) ? snapshot.captainId : ids[0] });
      this.persistDraft();
    } catch {
      if (!this._unloaded) this.setData({ loadError: '无法复制此编队，链接可能失效，请重试' });
    } finally {
      if (!this._unloaded) this.setData({ loading: false });
    }
  },

  invalidateShare() {
    this._revision += 1;
    this.setData({ preparedId: '', shareError: '', posterPath: '', posterError: '' });
    wx.hideShareMenu();
  },

  persistDraft(): boolean {
    const saved = saveSquadDraft({ version: 1, title: this.data.title, modelIds: this.data.modelIds, captainId: this.data.captainId });
    if (!saved) wx.showToast({ title: '草稿保存失败，请检查存储空间后重试', icon: 'none' });
    return saved;
  },

  handleSaveDraft() {
    if (this.persistDraft()) wx.showToast({ title: '草稿已保存', icon: 'success' });
  },

  handleTitle(e: WechatMiniprogram.Input) {
    this.invalidateShare();
    this.setData({ title: e.detail.value.slice(0, 30) });
    this.persistDraft();
  },

  handleSelection(e: WechatMiniprogram.CustomEvent<{ ids: string[]; models: GundamModel[] }>) {
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
    const id = e.currentTarget.dataset.id as string;
    if (!this.data.modelIds.includes(id) || id === this.data.captainId) return;
    this.invalidateShare();
    this.setData({ captainId: id });
    this.persistDraft();
  },

  handleRemove(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    const models = this.data.models.filter((model) => model.id !== id);
    this.handleSelection({ detail: { ids: models.map((model) => model.id), models } } as WechatMiniprogram.CustomEvent<{ ids: string[]; models: GundamModel[] }>);
  },

  async handlePrepareShare() {
    if (this.data.preparing) return;
    if (!this.data.models.length || !this.data.title.trim()) {
      wx.showToast({ title: '请填写编队名并选择至少 1 台机体', icon: 'none' });
      return;
    }
    const revision = this._revision;
    this.setData({ preparing: true, shareError: '' });
    try {
      const result = await createShare({ kind: 'squad', title: this.data.title.trim(), modelIds: this.data.modelIds.slice(), captainId: this.data.captainId });
      if (this._unloaded || revision !== this._revision) return;
      this.setData({ preparedId: result.id });
      wx.showShareMenu({ menus: ['shareAppMessage'] });
    } catch {
      if (!this._unloaded && revision === this._revision) this.setData({ shareError: '分享准备失败，请重试' });
    } finally {
      if (!this._unloaded) this.setData({ preparing: false });
    }
  },

  onShareAppMessage() {
    return { title: this.data.title.trim() || '我的六机出击', path: this.data.preparedId ? `/pages/share/share?id=${encodeURIComponent(this.data.preparedId)}` : '/pages/squad/squad' };
  },

  async handlePoster() {
    if (this.data.posterLoading) return;
    if (!this.data.models.length) { wx.showToast({ title: '先选择至少 1 台机体', icon: 'none' }); return; }
    const revision = this._revision;
    this.setData({ posterLoading: true, posterError: '' });
    try {
      const path = await generateSquadPoster(this, this.data.title.trim(), this.data.models, this.data.captainId);
      if (!this._unloaded && revision === this._revision) this.setData({ posterPath: path });
    } catch {
      if (!this._unloaded && revision === this._revision) this.setData({ posterError: '海报生成失败，请重试' });
    } finally {
      if (!this._unloaded) this.setData({ posterLoading: false });
    }
  },
  handlePreviewPoster() { if (this.data.posterPath) wx.previewImage({ urls: [this.data.posterPath] }); },
  handleSharePoster() {
    if (!this.data.posterPath) return;
    wx.showShareImageMenu({ path: this.data.posterPath, fail: () => wx.showToast({ title: '图片分享未完成，可预览或保存后发送', icon: 'none' }) });
  },
  handleSavePoster() {
    if (!this.data.posterPath) return;
    wx.saveImageToPhotosAlbum({ filePath: this.data.posterPath, success: () => wx.showToast({ title: '已保存到相册', icon: 'success' }), fail: () => wx.showToast({ title: '保存失败，请检查相册权限后重试', icon: 'none' }) });
  },
  handleQuiz() { if (this.persistDraft()) wx.navigateTo({ url: '/pages/quiz/quiz' }); },
  handleBack() { wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/home/home' }) }); },
});
