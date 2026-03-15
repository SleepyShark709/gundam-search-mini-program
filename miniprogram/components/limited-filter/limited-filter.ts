interface FilterItem {
  key: string;
  label: string;
}

const SUB_FILTERS: FilterItem[] = [
  { key: 'all', label: '全部' },
  { key: 'pbandai', label: 'P-Bandai' },
  { key: 'gbase', label: '高达基地' },
  { key: 'event', label: '活动限定' },
  { key: 'sidef', label: 'SIDE-F' },
  { key: 'other', label: '其他' },
];

Component({
  options: {
    virtualHost: true,
  },
  properties: {
    value: { type: String, value: 'all' },
    models: { type: Array, value: [] },
    visible: { type: Boolean, value: false },
  },
  data: {
    filters: [] as Array<{ key: string; label: string; count: number; disabled: boolean }>,
  },
  observers: {
    'models': function (models: any[]) {
      const counts: Record<string, number> = { all: models.length };
      for (const m of models) {
        const type = m.limitedType || 'other';
        counts[type] = (counts[type] || 0) + 1;
      }
      const filters = SUB_FILTERS.map((f) => ({
        key: f.key,
        label: f.label,
        count: counts[f.key] || 0,
        disabled: (counts[f.key] || 0) === 0 && f.key !== 'all',
      }));
      this.setData({ filters });
    },
  },
  methods: {
    handleTap(e: any) {
      const key = e.currentTarget.dataset.key;
      const item = this.data.filters.find((f) => f.key === key);
      if (item && !item.disabled) {
        this.triggerEvent('change', { value: key });
      }
    },
  },
});
