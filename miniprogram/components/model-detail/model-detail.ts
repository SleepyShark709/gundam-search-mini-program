import { formatJPY, formatCNY, calcTaxFree } from '../../utils/price';
import { formatDate } from '../../utils/format';
import { getModelImages } from '../../utils/model-service';

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
    hasTags: false,
    safeAreaBottom: 0,
    // 多图相关
    images: [] as string[],
    currentImageIndex: 0,
    imgLoadedMap: {} as Record<string, boolean>,
    // 入场/出场动画
    rendered: false,
    visible: false,
  },
  _openTimer: 0 as any,
  _closeTimer: 0 as any,
  lifetimes: {
    attached() {
      const app = getApp<IAppOption>();
      this.setData({ safeAreaBottom: app.globalData.safeAreaBottom });
    },
    detached() {
      if (this._openTimer) clearTimeout(this._openTimer);
      if (this._closeTimer) clearTimeout(this._closeTimer);
    },
  },
  pageLifetimes: {
    show() {
      // Skyline 渲染器从后台恢复时图片可能丢失渲染，强制重建 swiper
      if (this.data.open && this.data.model && this.data.images.length > 0) {
        const currentImages = this.data.images;
        this.setData({ images: [], imgLoadedMap: {} });
        wx.nextTick(() => {
          this.setData({ images: currentImages, currentImageIndex: 0 });
        });
      }
    },
  },
  observers: {
    'open': function (open: boolean) {
      if (this._openTimer) { clearTimeout(this._openTimer); this._openTimer = 0; }
      if (this._closeTimer) { clearTimeout(this._closeTimer); this._closeTimer = 0; }
      if (open) {
        this.setData({ rendered: true });
        this._openTimer = setTimeout(() => this.setData({ visible: true }), 20);
      } else {
        this.setData({ visible: false });
        this._closeTimer = setTimeout(() => this.setData({ rendered: false }), 280);
      }
    },
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
        hasTags: !!(model.tags && model.tags.length > 0),
      });
    },
    'model, open': function (model: any, open: boolean) {
      if (!model || !model.id || !open) return;

      // 立即显示主图
      this.setData({
        images: [model.imageUrl],
        currentImageIndex: 0,
        imgLoadedMap: {},
      });

      // 异步加载多图
      this._loadImages(model.series, model.id, model.imageUrl);
    },
  },
  methods: {
    async _loadImages(seriesCode: string, modelId: string, fallbackUrl: string) {
      const images = await getModelImages(seriesCode as any, modelId);
      if (images.length > 0) {
        this.setData({ images, imgLoadedMap: {} });
      }
      // 如果 API 返回空数组，保持单图（已在 observer 中设置）
    },
    handleSwiperChange(e: any) {
      this.setData({ currentImageIndex: e.detail.current });
    },
    handleSwiperImgLoad(e: any) {
      const index = e.currentTarget.dataset.index;
      this.setData({ [`imgLoadedMap.${index}`]: true });
    },
    handleClose() {
      this.triggerEvent('close');
    },
    handleBackdrop() {
      this.triggerEvent('close');
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
    preventBubble() {},
  },
});
