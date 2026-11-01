import { filterModels, getAllModels, refreshModels } from '../../utils/model-service';
import type { GundamModel, SeriesCode } from '../../utils/types';

const PAGE_SIZE = 24;

Component({
  options: { pureDataPattern: /^_/ },
  properties: {
    selectedIds: { type: Array, value: [] as string[] },
    limit: { type: Number, value: 6 },
  },
  data: {
    keyword: '',
    series: '',
    seriesOptions: [
      { code: '', label: '全部' }, { code: 'hg', label: 'HG' },
      { code: 'rg', label: 'RG' }, { code: 'mg', label: 'MG' }, { code: 'pg', label: 'PG' },
    ],
    candidates: [] as (GundamModel & { selected: boolean })[],
    resultCount: 0,
    loading: false,
    _allModels: [] as GundamModel[],
    _visibleCount: PAGE_SIZE,
    _unloaded: false,
  },
  observers: {
    selectedIds() { this.updateCandidates(); },
  },
  lifetimes: {
    attached() {
      this.data._allModels = getAllModels();
      this.updateCandidates();
      this.loadCatalog();
    },
    detached() { this.data._unloaded = true; },
  },
  methods: {
    async loadCatalog() {
      if (this.data.loading) return;
      this.setData({ loading: true });
      await Promise.allSettled((['hg', 'rg', 'mg', 'pg'] as SeriesCode[]).map((code) => refreshModels(code)));
      if (this.data._unloaded) return;
      this.data._allModels = getAllModels();
      this.setData({ loading: false });
      this.updateCandidates();
    },
    updateCandidates() {
      const all = this.data._allModels || [];
      const filtered = filterModels(all, { keyword: this.data.keyword.trim() })
        .filter((model) => !this.data.series || model.series === this.data.series);
      const ids = this.data.selectedIds as string[];
      this.setData({
        candidates: filtered.slice(0, this.data._visibleCount || PAGE_SIZE).map((model) => ({ ...model, selected: ids.includes(model.id) })),
        resultCount: filtered.length,
      });
    },
    handleSearch(e: WechatMiniprogram.Input) {
      this.data._visibleCount = PAGE_SIZE;
      this.setData({ keyword: e.detail.value });
      this.updateCandidates();
    },
    handleSeries(e: WechatMiniprogram.TouchEvent) {
      this.data._visibleCount = PAGE_SIZE;
      this.setData({ series: e.currentTarget.dataset.code as string });
      this.updateCandidates();
    },
    handleMore() {
      this.data._visibleCount += PAGE_SIZE;
      this.updateCandidates();
    },
    handleSelect(e: WechatMiniprogram.TouchEvent) {
      const id = e.currentTarget.dataset.id as string;
      const ids = (this.data.selectedIds as string[]).slice();
      if (!this.data._allModels.some((model) => model.id === id)) return;
      const index = ids.indexOf(id);
      if (index >= 0) ids.splice(index, 1);
      else if (ids.length < this.data.limit) ids.push(id);
      else {
        wx.showToast({ title: `最多选择 ${this.data.limit} 台`, icon: 'none' });
        return;
      }
      this.triggerEvent('change', { ids, models: ids.map((selectedId) => this.data._allModels.find((model) => model.id === selectedId)).filter(Boolean) });
    },
  },
});
