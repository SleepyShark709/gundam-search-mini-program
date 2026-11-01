import { canShareKind, featureRevision, getFeatures, isFeatureEnabled } from '../../utils/feature-flags';
import { bindPageFeatures, unbindPageFeatures } from '../../utils/feature-page';
import { getAllModels, refreshMissingModels } from '../../utils/model-service';
import { loadBuildProgress, saveBuildProgress, createShare, BuildProgress } from '../../utils/hangar-service';
import { localDate, summarizeBuilds } from '../../utils/build-summary';
import type { GundamModel } from '../../utils/types';

interface BuildItem extends BuildProgress {
  model: GundamModel | null;
  backlogCount: number;
  doneToday: boolean;
}

Page({
  _records: [] as BuildProgress[],
  _models: [] as GundamModel[],
  _unloaded: false,
  _loading: null as Promise<void> | null,
  _revision: 0,
  _loadRevision: 0,
  data: {
    features: getFeatures(), featureEnabled: false,
    loading: true, error: '', saving: false, sharing: false, shareId: '',
    items: [] as BuildItem[], selected: null as BuildItem | null,
    filter: 'all', filters: [{ id: 'all', label: '全部' }, { id: 'backlog', label: '未开盒' }, { id: 'building', label: '拼装中' }, { id: 'completed', label: '已完成' }],
    summary: summarizeBuilds([]),
    editOpen: false, editId: '', quantityInput: '1', completedInput: '0', buildingInput: '0', goalInput: '',
  },
  onShow() {
    bindPageFeatures(this, 'builds', (enabled) => {
      if (enabled) { void this.loadData(); return; }
      this._loadRevision++;
      this._revision++;
      this._loading = null;
      this.setData({ loading: false, error: '', saving: false, sharing: false, shareId: '' });
    });
    return isFeatureEnabled('builds') ? this.loadData() : Promise.resolve();
  },
  onUnload() { this._unloaded = true; unbindPageFeatures(this); },
  handleBack() { wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/home/home' }) }); },
  handleExplore() { wx.switchTab({ url: '/pages/home/home' }); },
  loadData(): Promise<void> {
    if (this._unloaded || !isFeatureEnabled('builds')) return Promise.resolve();
    if (this._loading || this.data.saving) return this._loading || Promise.resolve();
    const revision = ++this._loadRevision;
    this.setData({ loading: true, error: '' });
    this._loading = (async () => {
      try {
        const records = await loadBuildProgress();
        if (this._unloaded || revision !== this._loadRevision || !isFeatureEnabled('builds')) return;
        const models = await refreshMissingModels(records.map((record: BuildProgress) => record.modelId));
        if (this._unloaded || revision !== this._loadRevision || !isFeatureEnabled('builds')) return;
        this._records = records;
        this._models = models;
        this._revision++;
        this.render();
      } catch {
        if (!this._unloaded && revision === this._loadRevision && isFeatureEnabled('builds')) this.setData({ error: '机库同步失败，请重试；原有记录已保留。' });
      } finally {
        if (!this._unloaded && revision === this._loadRevision) this.setData({ loading: false });
      }
    })().finally(() => { if (revision === this._loadRevision) this._loading = null; });
    return this._loading;
  },
  render() {
    const catalog = new Map((this._models.length ? this._models : getAllModels()).map((model: GundamModel) => [model.id, model]));
    const today = localDate();
    const items = this._records.map((record: BuildProgress) => ({
      ...record, model: catalog.get(record.modelId) || null,
      backlogCount: record.quantity - record.completedCount - record.buildingCount,
      doneToday: record.goalDoneDate === today,
    })).filter((item: BuildItem) => this.data.filter === 'all'
      || (this.data.filter === 'backlog' && item.backlogCount > 0)
      || (this.data.filter === 'building' && item.buildingCount > 0)
      || (this.data.filter === 'completed' && item.completedCount > 0));
    const selected = this.data.selected
      ? items.find((item: BuildItem) => item.modelId === this.data.selected!.modelId) || null : null;
    this.setData({ items, selected, summary: summarizeBuilds(this._records), shareId: '' });
  },
  handleFilter(e: WechatMiniprogram.TouchEvent) {
    if (!isFeatureEnabled('builds')) return;
    this.setData({ filter: e.currentTarget.dataset.id as string });
    this.render();
  },
  handleDraw() {
    if (!isFeatureEnabled('builds')) return;
    const candidates = this._records.filter((record: BuildProgress) => record.quantity > record.completedCount);
    if (!candidates.length) { wx.showToast({ title: '机库已全部整备完成', icon: 'none' }); return; }
    const chosen = candidates[Math.floor(Math.random() * candidates.length)];
    this.setData({ filter: 'all' });
    this.render();
    this.setData({ selected: this.data.items.find((item: BuildItem) => item.modelId === chosen.modelId)! });
  },
  handleEdit(e: WechatMiniprogram.TouchEvent) {
    if (!isFeatureEnabled('builds')) return;
    if (this.data.saving) return;
    const record = this._records.find((item: BuildItem) => item.modelId === e.currentTarget.dataset.id);
    if (!record) return;
    this.setData({ editOpen: true, editId: record.modelId, quantityInput: String(record.quantity),
      completedInput: String(record.completedCount), buildingInput: String(record.buildingCount), goalInput: record.goal });
  },
  handleCloseEdit() { if (!this.data.saving) this.setData({ editOpen: false }); },
  handleInput(e: WechatMiniprogram.Input) {
    if (!isFeatureEnabled('builds')) return;
    const field = e.currentTarget.dataset.field as string;
    if (['quantityInput', 'completedInput', 'buildingInput', 'goalInput'].includes(field)) this.setData({ [field]: e.detail.value });
  },
  async handleSave() {
    if (!isFeatureEnabled('builds')) return;
    if (this.data.saving) return;
    const previous = this._records.find((record: BuildProgress) => record.modelId === this.data.editId);
    if (!previous) return;
    const quantity = Number(this.data.quantityInput);
    const completedCount = Number(this.data.completedInput);
    const buildingCount = Number(this.data.buildingInput);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 999
      || !Number.isInteger(completedCount) || completedCount < 0
      || !Number.isInteger(buildingCount) || buildingCount < 0 || completedCount + buildingCount > quantity) {
      wx.showToast({ title: '请检查数量，完成与在拼不能超过总数', icon: 'none' }); return;
    }
    const goal = this.data.goalInput.trim();
    if (goal.length > 100) { wx.showToast({ title: '目标最多100字', icon: 'none' }); return; }
    await this.save({ ...previous, quantity, completedCount, buildingCount, goal,
      goalDoneDate: goal === previous.goal ? previous.goalDoneDate : null });
  },
  async save(record: BuildProgress) {
    if (!isFeatureEnabled('builds') || this.data.saving || this.data.loading) return;
    const epoch = featureRevision();
    this.setData({ saving: true });
    try {
      const saved = await saveBuildProgress(record);
      if (this._unloaded || epoch !== featureRevision() || !isFeatureEnabled('builds')) return;
      this._records = this._records.map((item: BuildProgress) => item.modelId === saved.modelId ? saved : item);
      this._revision++;
      this.render();
      this.setData({ editOpen: false });
      wx.showToast({ title: '整备记录已保存', icon: 'success' });
    } catch {
      if (!this._unloaded && epoch === featureRevision() && isFeatureEnabled('builds')) wx.showToast({ title: '保存失败，请重试', icon: 'none' });
    } finally {
      if (!this._unloaded && epoch === featureRevision()) this.setData({ saving: false });
    }
  },
  async handleGoalDone(e: WechatMiniprogram.TouchEvent) {
    if (!isFeatureEnabled('builds')) return;
    const record = this._records.find((item: BuildItem) => item.modelId === e.currentTarget.dataset.id);
    if (!record || !record.goal.trim() || record.goalDoneDate === localDate()) return;
    await this.save({ ...record, goalDoneDate: localDate() });
  },
  handleModel(e: WechatMiniprogram.TouchEvent) {
    if (!isFeatureEnabled('builds')) return;
    wx.navigateTo({ url: `/pages/model/model?id=${encodeURIComponent(e.currentTarget.dataset.id as string)}` });
  },
  async handlePrepareReport() {
    if (!canShareKind('report')) return;
    const epoch = featureRevision();
    if (this.data.sharing || this.data.saving || this.data.loading) return;
    const modelIds = this._records.map((record: BuildProgress) => record.modelId);
    if (!modelIds.length) return;
    this.setData({ sharing: true });
    const revision = this._revision;
    const report = summarizeBuilds(this._records.slice(0, 50));
    try {
      const result = await createShare({ kind: 'report', title: '我的机库整备战报', modelIds: modelIds.slice(0, 50),
        report: { quantity: report.quantity, completedCount: report.completedCount, buildingCount: report.buildingCount } });
      if (this._unloaded || revision !== this._revision || epoch !== featureRevision() || !canShareKind('report')) return;
      this.setData({ shareId: result.id });
      wx.navigateTo({ url: `/pages/share/share?id=${encodeURIComponent(result.id)}` });
    } catch {
      if (!this._unloaded && epoch === featureRevision() && canShareKind('report')) wx.showToast({ title: '战报生成失败，请重试', icon: 'none' });
    } finally {
      if (!this._unloaded && epoch === featureRevision()) this.setData({ sharing: false });
    }
  },
  onShareAppMessage() {
    if (!isFeatureEnabled('builds')) return { title: '高达模型目录', path: '/pages/home/home' };
    return canShareKind('report') && this.data.shareId ? { title: '我的机库整备战报', path: `/pages/share/share?id=${this.data.shareId}` }
      : { title: '一起完成机库整备', path: '/pages/builds/builds' };
  },
});
