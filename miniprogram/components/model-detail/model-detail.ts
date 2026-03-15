import { formatJPY, formatCNY, calcTaxFree } from '../../utils/price';
import { formatDate } from '../../utils/format';

Component({
  options: {
    virtualHost: true,
  },
  properties: {
    model: { type: Object, value: null },
    open: { type: Boolean, value: false },
    isFavorite: { type: Boolean, value: false },
    isPurchased: { type: Boolean, value: false },
    exchangeRate: { type: Number, value: 0.05 },
  },
  data: {
    seriesLabel: '',
    numberLabel: '',
    priceJPY: '',
    priceCNY: '',
    priceTaxFree: '',
    dateText: '',
    imgLoaded: false,
    hasTags: false,
    safeAreaBottom: 0,
  },
  lifetimes: {
    attached() {
      const app = getApp<IAppOption>();
      this.setData({ safeAreaBottom: app.globalData.safeAreaBottom });
    },
  },
  observers: {
    'model, exchangeRate': function (model: any, rate: number) {
      if (!model || !model.id) return;
      const cny = model.price * rate;
      this.setData({
        seriesLabel: (model.series || '').toUpperCase(),
        numberLabel: `#${String(model.number || 0).padStart(3, '0')}`,
        priceJPY: model.price > 0 ? formatJPY(model.price) : '',
        priceCNY: model.price > 0 ? formatCNY(cny) : '',
        priceTaxFree: model.price > 0 ? formatJPY(calcTaxFree(model.price)) : '',
        dateText: model.releaseDate ? formatDate(model.releaseDate) : '',
        imgLoaded: false,
        hasTags: !!(model.tags && model.tags.length > 0),
      });
    },
  },
  methods: {
    handleClose() {
      this.triggerEvent('close');
    },
    handleBackdrop() {
      this.triggerEvent('close');
    },
    handleImgLoad() {
      this.setData({ imgLoaded: true });
    },
    handleFavToggle() {
      if (this.data.model) {
        this.triggerEvent('togglefavorite', { id: this.data.model.id });
      }
    },
    handlePurchase() {
      if (this.data.model) {
        this.triggerEvent('purchase', { id: this.data.model.id, name: this.data.model.name });
      }
    },
    handleOpenUrl() {
      if (this.data.model && this.data.model.productUrl) {
        wx.setClipboardData({
          data: this.data.model.productUrl,
          success: () => {
            wx.showToast({ title: '链接已复制', icon: 'success' });
          },
        });
      }
    },
    preventBubble() {},
  },
});
