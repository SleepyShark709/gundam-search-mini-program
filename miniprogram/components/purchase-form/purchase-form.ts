Component({
  options: {
    virtualHost: true,
  },
  properties: {
    open: { type: Boolean, value: false },
    modelId: { type: String, value: '' },
    modelName: { type: String, value: '' },
    priceCny: { type: null, value: null },
    purchaseDate: { type: null, value: null },
    channel: { type: null, value: null },
    note: { type: null, value: null },
  },
  data: {
    formPrice: '',
    formDate: '',
    formChannel: '',
    formNote: '',
    safeAreaBottom: 0,
  },
  lifetimes: {
    attached() {
      const app = getApp<IAppOption>();
      this.setData({ safeAreaBottom: app.globalData.safeAreaBottom });
    },
  },
  observers: {
    'open': function(open: boolean) {
      if (open) {
        this.setData({
          formPrice: this.data.priceCny != null ? String(this.data.priceCny) : '',
          formDate: this.data.purchaseDate || '',
          formChannel: this.data.channel || '',
          formNote: this.data.note || '',
        });
      }
    },
  },
  methods: {
    handleClose() {
      this.triggerEvent('close');
    },
    handleBackdrop() {
      this.triggerEvent('close');
    },
    preventBubble() {},
    handlePriceInput(e: any) {
      this.setData({ formPrice: e.detail.value });
    },
    handleDateChange(e: any) {
      this.setData({ formDate: e.detail.value });
    },
    handleChannelInput(e: any) {
      this.setData({ formChannel: e.detail.value });
    },
    handleNoteInput(e: any) {
      this.setData({ formNote: e.detail.value });
    },
    handleSubmit() {
      const data: any = { modelId: this.data.modelId };
      if (this.data.formPrice) data.priceCny = parseFloat(this.data.formPrice);
      if (this.data.formDate) data.purchaseDate = this.data.formDate;
      if (this.data.formChannel) data.channel = this.data.formChannel;
      if (this.data.formNote) data.note = this.data.formNote;
      this.triggerEvent('submit', data);
    },
  },
});
