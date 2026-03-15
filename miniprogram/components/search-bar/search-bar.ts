Component({
  options: {
    virtualHost: true,
  },
  properties: {
    value: { type: String, value: '' },
    placeholder: { type: String, value: '搜索高达型号...' },
  },
  methods: {
    handleInput(e: any) {
      this.triggerEvent('input', { value: e.detail.value });
    },
    handleClear() {
      this.triggerEvent('input', { value: '' });
      this.triggerEvent('clear');
    },
  },
});
