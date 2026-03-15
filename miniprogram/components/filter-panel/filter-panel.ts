Component({
  options: {
    virtualHost: true,
  },
  properties: {
    open: { type: Boolean, value: false },
    releaseDateFrom: { type: String, value: '' },
    releaseDateTo: { type: String, value: '' },
    numberFrom: { type: String, value: '' },
    numberTo: { type: String, value: '' },
  },
  methods: {
    handleBackdropTap() {
      this.triggerEvent('close');
    },
    handleDateFromInput(e: any) {
      this.triggerEvent('filterchange', { field: 'releaseDateFrom', value: e.detail.value });
    },
    handleDateToInput(e: any) {
      this.triggerEvent('filterchange', { field: 'releaseDateTo', value: e.detail.value });
    },
    handleNumFromInput(e: any) {
      this.triggerEvent('filterchange', { field: 'numberFrom', value: e.detail.value });
    },
    handleNumToInput(e: any) {
      this.triggerEvent('filterchange', { field: 'numberTo', value: e.detail.value });
    },
    handleReset() {
      this.triggerEvent('reset');
    },
  },
});
