import { canShareKind, featureRevision, FeatureUnavailableError, getFeatures, isFeatureEnabled } from '../../utils/feature-flags';
import { bindPageFeatures, isCurrentPage, unbindPageFeatures } from '../../utils/feature-page';
import { getShare, submitQuiz } from '../../utils/hangar-service';
import type { ShareKind, ShareSnapshot } from '../../utils/hangar-service';
import type { GundamModel } from '../../utils/types';

type PublicModel = Pick<GundamModel, 'id' | 'name' | 'series' | 'number' | 'releaseDate' | 'imageUrl' | 'isLimited'>;
interface PublicQuestion {
  id: string;
  prompt: string;
  optionIds: string[];
  options: PublicModel[];
  selectedId: string;
  correctId: string;
  correctName: string;
}
interface PublicSnapshot {
  id: string;
  kind: ShareKind;
  title: string;
  models: PublicModel[];
  captainId: string;
  questions: PublicQuestion[];
  report: { quantity: number; completedCount: number; buildingCount: number } | null;
}
const KIND_LABELS: Record<ShareKind, string> = { squad: '六机出击', quiz: '默契测试', wishlist: '心愿单', purchased: '模型收藏', compare: '机体对比', report: '年度机库报告' };

// 只保留公开展示字段，购买价格、渠道和备注不会进入页面状态。
function publicSnapshot(snapshot: ShareSnapshot, id: string): PublicSnapshot {
  if (!snapshot || !KIND_LABELS[snapshot.kind] || typeof snapshot.title !== 'string' || !Array.isArray(snapshot.models)) throw new Error('无效分享');
  const models = snapshot.models.map((model): PublicModel => {
    if (!model || typeof model.id !== 'string' || typeof model.name !== 'string') throw new Error('无效模型');
    return { id: model.id, name: model.name, series: model.series, number: model.number, releaseDate: model.releaseDate, imageUrl: model.imageUrl, isLimited: !!model.isLimited };
  });
  const questions = (snapshot.kind === 'quiz' ? snapshot.questions || [] : []).map((question, index): PublicQuestion => {
    if (typeof question.prompt !== 'string' || !Array.isArray(question.optionIds) || question.optionIds.length !== 3 || new Set(question.optionIds).size !== 3) throw new Error('无效题目');
    const options = question.optionIds.map((optionId) => models.find((model) => model.id === optionId));
    if (options.some((option) => !option)) throw new Error('题目机体缺失');
    return { id: `question-${index}`, prompt: question.prompt, optionIds: question.optionIds, options: options as PublicModel[], selectedId: '', correctId: '', correctName: '' };
  });
  if (snapshot.kind === 'quiz' && questions.length !== 3) throw new Error('无效测试');
  const report = snapshot.kind === 'report' ? snapshot.report : undefined;
  if (snapshot.kind === 'report' && (!report || ![report.quantity, report.completedCount, report.buildingCount].every((value) => Number.isInteger(value) && value >= 0))) throw new Error('无效报告');
  return {
    id, kind: snapshot.kind, title: snapshot.title, models,
    captainId: snapshot.captainId && models.some((model) => model.id === snapshot.captainId) ? snapshot.captainId : '',
    questions,
    report: report ? { quantity: report.quantity, completedCount: report.completedCount, buildingCount: report.buildingCount } : null,
  };
}

Page({
  _id: '',
  _unloaded: false,
  _loadRequest: 0,
  _loadingSnapshot: null as Promise<void> | null,
  data: {
    features: getFeatures(),
    featureEnabled: false,
    snapshot: null as PublicSnapshot | null,
    kindLabel: '',
    loading: true,
    loadError: '',
    answers: ['', '', ''],
    submitting: false,
    submitError: '',
    result: null as { score: number; total: number } | null,
    safeAreaBottom: 0,
  },

  onLoad(options: Record<string, string | undefined>) {
    this._id = options.id || '';
    this.setData({ safeAreaBottom: getApp<IAppOption>().globalData.safeAreaBottom });
    if (isCurrentPage(this)) wx.hideShareMenu();
    unbindPageFeatures(this);
    bindPageFeatures(this, 'sharing', (enabled) => {
      this._loadRequest++;
      if (enabled) { this._loadingSnapshot = this.loadSnapshot(); return; }
      if (isCurrentPage(this)) wx.hideShareMenu();
      this.setData({ featureEnabled: false, loading: false, loadError: '', submitting: false });
    });
    return this._loadingSnapshot || Promise.resolve();
  },
  onShow() {
    if (!isCurrentPage(this)) return;
    if (!!this.data.snapshot && canShareKind(this.data.snapshot.kind) && this.data.featureEnabled) wx.showShareMenu({ menus: ['shareAppMessage'] });
    else wx.hideShareMenu();
  },
  onUnload() { this._unloaded = true; unbindPageFeatures(this); },

  async loadSnapshot() {
    if (!isFeatureEnabled('sharing')) return;
    const epoch = featureRevision();
    if (!this._id || this._id.length > 100 || !/^[A-Za-z0-9_-]+$/.test(this._id)) {
      this.setData({ loading: false, loadError: '分享链接无效，请从好友发送的小程序卡片重新打开' });
      return;
    }
    const request = ++this._loadRequest;
    const id = this._id;
    this.setData({ loading: true, loadError: '' });
    try {
      const response = await getShare(id);
      if (this._unloaded || request !== this._loadRequest || id !== this._id || epoch !== featureRevision()) return;
      if (!canShareKind(response.kind)) { this.setData({ featureEnabled: false }); return; }
      const snapshot = publicSnapshot(response, id);
      const previous = this.data.snapshot;
      const sameQuiz = previous?.id === snapshot.id && previous.kind === 'quiz' && snapshot.kind === 'quiz'
        && snapshot.questions.every((question, index) => question.prompt === previous.questions[index]?.prompt
          && JSON.stringify(question.optionIds) === JSON.stringify(previous.questions[index].optionIds));
      const answers = sameQuiz ? snapshot.questions.map((question, index) => question.optionIds.includes(this.data.answers[index]) ? this.data.answers[index] : '') : ['', '', ''];
      const result = sameQuiz && this.data.result && answers.every(Boolean)
        && snapshot.questions.every((question, index) => question.optionIds.includes(previous!.questions[index].correctId)) ? this.data.result : null;
      snapshot.questions = snapshot.questions.map((question, index) => ({
        ...question, selectedId: answers[index],
        correctId: result ? previous!.questions[index].correctId : '',
        correctName: result ? question.options.find((model) => model.id === previous!.questions[index].correctId)!.name : '',
      }));
      this.setData({ snapshot, kindLabel: KIND_LABELS[snapshot.kind], answers, result, submitError: '' });
      if (isCurrentPage(this)) wx.showShareMenu({ menus: ['shareAppMessage'] });
    } catch (error) {
      if (error instanceof FeatureUnavailableError) {
        if (!this._unloaded && request === this._loadRequest) this.setData({ featureEnabled: false });
        return;
      }
      if (!this._unloaded && request === this._loadRequest && epoch === featureRevision()) this.setData({ loadError: '分享暂时无法打开，可能已失效或网络异常，请重试' });
    } finally {
      if (!this._unloaded && request === this._loadRequest) this.setData({ loading: false });
    }
  },

  handleAnswer(e: WechatMiniprogram.TouchEvent) {
    if (this.data.result || this.data.submitting || !this.data.snapshot || !canShareKind(this.data.snapshot.kind)) return;
    const index = Number(e.currentTarget.dataset.index);
    const id = e.currentTarget.dataset.id as string;
    const question = this.data.snapshot.questions[index];
    if (!question || !question.optionIds.includes(id)) return;
    const answers = this.data.answers.slice();
    answers[index] = id;
    const questions = this.data.snapshot.questions.map((item, questionIndex) => questionIndex === index ? { ...item, selectedId: id } : item);
    this.setData({ answers, snapshot: { ...this.data.snapshot, questions }, submitError: '' });
  },

  async handleSubmitQuiz() {
    const snapshot = this.data.snapshot;
    if (!canShareKind('quiz')) return;
    const request = this._loadRequest;
    const epoch = featureRevision();
    if (!snapshot || snapshot.kind !== 'quiz' || this.data.submitting || this.data.result) return;
    if (snapshot.questions.some((question, index) => !question.optionIds.includes(this.data.answers[index]))) {
      wx.showToast({ title: '请完成全部 3 道题', icon: 'none' });
      return;
    }
    const answers = this.data.answers.slice();
    this.setData({ submitting: true, submitError: '' });
    try {
      const result = await submitQuiz(this._id, answers);
      if (this._unloaded || request !== this._loadRequest || epoch !== featureRevision() || !canShareKind('quiz')) return;
      if (!Number.isInteger(result.score) || result.total !== 3 || result.score < 0 || result.score > 3 || !Array.isArray(result.correctAnswers) || result.correctAnswers.length !== 3
        || snapshot.questions.some((question, index) => !question.optionIds.includes(result.correctAnswers[index]))) throw new Error('判分结果无效');
      const questions = snapshot.questions.map((question, index) => ({ ...question, correctId: result.correctAnswers[index], correctName: question.options.find((model) => model.id === result.correctAnswers[index])!.name }));
      this.setData({ result: { score: result.score, total: result.total }, snapshot: { ...snapshot, questions } });
    } catch {
      if (!this._unloaded && request === this._loadRequest && epoch === featureRevision() && canShareKind('quiz')) this.setData({ submitError: '判分失败，已保留答案，请重试' });
    } finally {
      if (!this._unloaded && request === this._loadRequest) this.setData({ submitting: false });
    }
  },

  handleModel(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    if (this.data.snapshot && canShareKind(this.data.snapshot.kind) && this.data.snapshot.models.some((model) => model.id === id)) wx.navigateTo({ url: `/pages/model/model?id=${encodeURIComponent(id)}` });
  },
  handleCopySquad() {
    if (canShareKind('squad') && this.data.snapshot && this.data.snapshot.kind === 'squad') wx.navigateTo({ url: `/pages/squad/squad?shareId=${encodeURIComponent(this._id)}` });
  },
  handleCreate() {
    if (!this.data.snapshot || !canShareKind(this.data.snapshot.kind) || !isFeatureEnabled(this.data.snapshot.kind === 'quiz' ? 'quiz' : 'squad')) return;
    wx.navigateTo({ url: this.data.snapshot && this.data.snapshot.kind === 'quiz' ? '/pages/quiz/quiz' : '/pages/squad/squad' });
  },
  handleExplore() { wx.switchTab({ url: '/pages/home/home' }); },
  handleBack() { wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/home/home' }) }); },
  onShareAppMessage() {
    if (!this.data.snapshot || !canShareKind(this.data.snapshot.kind)) return { title: '高达模型目录', path: '/pages/home/home' };
    return { title: this.data.snapshot ? this.data.snapshot.title : '高达模型机库', path: this.data.snapshot ? `/pages/share/share?id=${encodeURIComponent(this._id)}` : '/pages/home/home' };
  },
});
