import { getAllModels, refreshMissingModels } from '../../utils/model-service';
import { loadSquadDraft } from '../../utils/squad-draft';
import { createShare } from '../../utils/hangar-service';
import type { GundamModel } from '../../utils/types';

const PROMPTS = ['我的本命机体是哪台？', '我的第一盒高达是哪台？', '我现在最想拼哪台？'];
interface QuestionDraft {
  id: string;
  prompt: string;
  templateIndex: number;
  models: GundamModel[];
  optionIds: string[];
  answerId: string;
}

Page({
  _revision: 0,
  _unloaded: false,
  data: {
    title: '谁更懂我的机库？',
    templates: PROMPTS,
    questions: PROMPTS.map((prompt, templateIndex): QuestionDraft => ({ id: `question-${templateIndex}`, prompt, templateIndex, models: [], optionIds: [], answerId: '' })),
    pickerOpen: false,
    activeQuestion: 0,
    activeOptionIds: [] as string[],
    squadModels: [] as GundamModel[],
    preparedId: '',
    preparing: false,
    shareError: '',
    safeAreaBottom: 0,
  },

  async onLoad() {
    this.setData({ safeAreaBottom: getApp<IAppOption>().globalData.safeAreaBottom });
    wx.hideShareMenu();
    const { draft } = loadSquadDraft();
    if (!draft || !draft.modelIds.length) return;
    let catalog = getAllModels();
    try { catalog = await refreshMissingModels(draft.modelIds); } catch { /* 使用本地目录 */ }
    if (this._unloaded) return;
    this.setData({ squadModels: draft.modelIds.map((id) => catalog.find((model) => model.id === id)).filter((model): model is GundamModel => !!model) });
  },
  onUnload() { this._unloaded = true; },

  invalidateShare() {
    this._revision += 1;
    this.setData({ preparedId: '', shareError: '' });
    wx.hideShareMenu();
  },
  handleTitle(e: WechatMiniprogram.Input) {
    this.invalidateShare();
    this.setData({ title: e.detail.value.slice(0, 30) });
  },
  handleTemplate(e: WechatMiniprogram.PickerChange) {
    const index = Number(e.currentTarget.dataset.index);
    const templateIndex = Number(e.detail.value);
    if (!this.data.questions[index] || !PROMPTS[templateIndex]) return;
    this.invalidateShare();
    const questions = this.data.questions.map((question, questionIndex) => questionIndex === index ? { ...question, prompt: PROMPTS[templateIndex], templateIndex } : question);
    this.setData({ questions });
  },
  handleOpenPicker(e: WechatMiniprogram.TouchEvent) {
    const index = Number(e.currentTarget.dataset.index);
    if (!this.data.questions[index]) return;
    this.setData({ pickerOpen: true, activeQuestion: index, activeOptionIds: this.data.questions[index].optionIds });
  },
  handleClosePicker() {
    const question = this.data.questions[this.data.activeQuestion];
    if (question.optionIds.length !== 3) {
      wx.showToast({ title: '每题需要恰好 3 台候选机体', icon: 'none' });
      return;
    }
    this.setData({ pickerOpen: false });
  },
  handleCancelPicker() { this.setData({ pickerOpen: false }); },
  handleSelection(e: WechatMiniprogram.CustomEvent<{ ids: string[]; models: GundamModel[] }>) {
    const { ids, models } = e.detail;
    if (ids.length > 3 || new Set(ids).size !== ids.length || ids.length !== models.length) return;
    this.invalidateShare();
    const questions = this.data.questions.map((question, index) => index === this.data.activeQuestion ? {
      ...question, optionIds: ids, models, answerId: ids.includes(question.answerId) ? question.answerId : '',
    } : question);
    this.setData({ questions, activeOptionIds: ids });
  },
  handleUseSquad() {
    const models = this.data.squadModels.slice(0, 3);
    if (models.length < 3) { wx.showToast({ title: '编队至少需要 3 台才能复用选项', icon: 'none' }); return; }
    this.handleSelection({ detail: { ids: models.map((model) => model.id), models } } as WechatMiniprogram.CustomEvent<{ ids: string[]; models: GundamModel[] }>);
    wx.showToast({ title: '已使用编队前 3 台', icon: 'success' });
  },
  handleAnswer(e: WechatMiniprogram.TouchEvent) {
    const index = Number(e.currentTarget.dataset.index);
    const id = e.currentTarget.dataset.id as string;
    if (!this.data.questions[index] || !this.data.questions[index].optionIds.includes(id)) return;
    this.invalidateShare();
    const questions = this.data.questions.map((question, questionIndex) => questionIndex === index ? { ...question, answerId: id } : question);
    this.setData({ questions });
  },
  async handlePrepareShare() {
    if (this.data.preparing) return;
    if (!this.data.title.trim() || this.data.questions.some((question) => question.optionIds.length !== 3 || !question.optionIds.includes(question.answerId))) {
      wx.showToast({ title: '请为 3 道题各选 3 台机体并指定答案', icon: 'none' });
      return;
    }
    const revision = this._revision;
    this.setData({ preparing: true, shareError: '' });
    try {
      const questions = this.data.questions.map(({ prompt, optionIds, answerId }) => ({ prompt, optionIds: optionIds.slice(), answerId }));
      const modelIds = [...new Set(questions.flatMap((question) => question.optionIds))];
      const result = await createShare({ kind: 'quiz', title: this.data.title.trim(), modelIds, questions });
      if (this._unloaded || revision !== this._revision) return;
      this.setData({ preparedId: result.id });
      wx.showShareMenu({ menus: ['shareAppMessage'] });
    } catch {
      if (!this._unloaded && revision === this._revision) this.setData({ shareError: '测试保存失败，请检查网络后重试' });
    } finally {
      if (!this._unloaded) this.setData({ preparing: false });
    }
  },
  onShareAppMessage() {
    return { title: this.data.title.trim() || '谁更懂我的机库？', path: this.data.preparedId ? `/pages/share/share?id=${encodeURIComponent(this.data.preparedId)}` : '/pages/quiz/quiz' };
  },
  handleBack() { wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/home/home' }) }); },
});
