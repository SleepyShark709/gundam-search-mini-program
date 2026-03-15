const SERIES_ACCENT: Record<string, string> = {
  hg: '#00d4ff',
  rg: '#ff8800',
  mg: '#aa44ff',
  pg: '#ffcc00',
};

Component({
  options: {
    virtualHost: true,
  },
  properties: {
    series: {
      type: Object,
      value: {},
    },
  },
  data: {
    accent: '#00d4ff',
  },
  observers: {
    'series.code': function (code: string) {
      this.setData({ accent: SERIES_ACCENT[code] || '#00d4ff' });
    },
  },
  methods: {
    handleTap() {
      const code = this.data.series.code;
      wx.navigateTo({ url: `/pages/series/series?code=${code}` });
    },
  },
});
