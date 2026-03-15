Component({
  options: {
    virtualHost: true,
  },
  properties: {
    activeTab: { type: String, value: 'regular' },
    regularCount: { type: Number, value: 0 },
    limitedCount: { type: Number, value: 0 },
  },
  methods: {
    handleTabTap(e: any) {
      const tab = e.currentTarget.dataset.tab;
      this.triggerEvent('change', { tab });
    },
  },
});
