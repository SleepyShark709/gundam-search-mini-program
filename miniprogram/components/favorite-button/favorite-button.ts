Component({
  options: {
    virtualHost: true,
  },
  properties: {
    active: {
      type: Boolean,
      value: false,
    },
  },
  methods: {
    handleTap() {
      wx.vibrateShort({ type: 'light' });
      this.triggerEvent('toggle');
    },
  },
});
