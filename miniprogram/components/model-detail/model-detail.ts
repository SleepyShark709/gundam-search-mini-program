import { formatJPY, formatCNY, calcTaxFree } from '../../utils/price';
import { formatDate } from '../../utils/format';
import { getModelImages } from '../../utils/model-service';
import { GundamModel, SeriesCode } from '../../utils/types';

Component({
  options: {
    virtualHost: true,
    pureDataPattern: /^_/,
  },
  properties: {
    model: { type: null, value: null as GundamModel | null },
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
    _openTimer: 0,
    _closeTimer: 0,
    _imageRequestId: 0,
  },
  lifetimes: {
    attached() {
      const app = getApp<IAppOption>();
      this.setData({ safeAreaBottom: app.globalData.safeAreaBottom });
    },
    detached() {
      this.data._imageRequestId += 1;
      if (this.data._openTimer) clearTimeout(this.data._openTimer);
      if (this.data._closeTimer) clearTimeout(this.data._closeTimer);
    },
  },
  pageLifetimes: {
    show() {
      // Skyline 渲染器从后台恢复时图片可能丢失渲染，强制重建 swiper
      if (this.data.open && this.data.model && this.data.images.length > 0) {
        const currentImages = this.data.images;
        const modelId = this.data.model.id;
        const requestId = this.data._imageRequestId;
        this.setData({ images: [], imgLoadedMap: {} });
        wx.nextTick(() => {
          if (!this.data.open || this.data.model?.id !== modelId || this.data._imageRequestId !== requestId) return;
          this.setData({ images: currentImages, currentImageIndex: 0 });
        });
      }
    },
  },
  observers: {
    'open': function (open: boolean) {
      if (this.data._openTimer) { clearTimeout(this.data._openTimer); this.data._openTimer = 0; }
      if (this.data._closeTimer) { clearTimeout(this.data._closeTimer); this.data._closeTimer = 0; }
      if (open) {
        this.setData({ rendered: true });
        this.data._openTimer = setTimeout(() => this.setData({ visible: true }), 20);
      } else {
        this.setData({ visible: false });
        this.data._closeTimer = setTimeout(() => this.setData({ rendered: false }), 280);
      }
    },
    'model, exchangeRate': function (model: GundamModel | null, rate: number) {
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
    'model, open': function (model: GundamModel | null, open: boolean) {
      if (!model || !model.id || !open) {
        this.data._imageRequestId += 1;
        return;
      }

      // 立即显示主图
      this.setData({
        images: [model.imageUrl],
        currentImageIndex: 0,
        imgLoadedMap: {},
      });

      // 异步加载多图
      this._loadImages(model.series, model.id);
    },
  },
  methods: {
    handleDossier() {
      const model = this.data.model;
      if (!model) return;
      const pages = getCurrentPages();
      if (pages[pages.length - 1]?.route === 'pages/model/model') {
        this.triggerEvent('close');
      } else {
        wx.navigateTo({ url: `/pages/model/model?id=${encodeURIComponent(model.id)}` });
      }
    },
    async _loadImages(seriesCode: SeriesCode, modelId: string) {
      const requestId = ++this.data._imageRequestId;
      const images = await getModelImages(seriesCode, modelId);
      if (!this.data.open || this.data.model?.id !== modelId || this.data._imageRequestId !== requestId) return;
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
