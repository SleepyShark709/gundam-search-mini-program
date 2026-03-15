Component({
  options: {
    virtualHost: true,
  },
  properties: {
    options: { type: Array, value: [] },
    value: { type: String, value: '' },
  },
  methods: {
    handleTap(e: any) {
      const val = e.currentTarget.dataset.value;
      this.triggerEvent('change', { value: val });
    },
  },
});
