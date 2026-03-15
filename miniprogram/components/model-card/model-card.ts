import { formatDate } from '../../utils/format';

const LIMITED_BADGE: Record<string, { label: string; variant: string }> = {
  pbandai: { label: 'P-Bandai', variant: 'pbandai' },
  gbase: { label: '高达基地', variant: 'gbase' },
  event: { label: '活动限定', variant: 'event' },
  sidef: { label: 'SIDE-F', variant: 'sidef' },
  other: { label: '限定', variant: 'danger' },
};

Component({
  properties: {
    model: { type: Object, value: {} },
    isFavorite: { type: Boolean, value: false },
    exchangeRate: { type: Number, value: 0.05 },
  },
  data: {
    imgLoaded: false,
    imgError: false,
    numberText: '#001',
    dateText: '',
    badgeLabel: '',
    badgeVariant: '',
    showBadge: false,
  },
  observers: {
    'model': function (model: any) {
      if (!model || !model.id) return;
      const num = String(model.number || 0).padStart(3, '0');
      const dateText = model.releaseDate ? formatDate(model.releaseDate) : '';
      const badgeInfo = model.isLimited ? (LIMITED_BADGE[model.limitedType || 'other'] || LIMITED_BADGE['other']) : null;
      const data: Record<string, any> = {
        numberText: `#${num}`,
        dateText,
        showBadge: !!badgeInfo,
        badgeLabel: badgeInfo ? badgeInfo.label : '',
        badgeVariant: badgeInfo ? badgeInfo.variant : '',
      };
      // Only reset image state when the model actually changes
      if ((this as any)._lastModelId !== model.id) {
        (this as any)._lastModelId = model.id;
        data.imgLoaded = false;
        data.imgError = false;
      }
      this.setData(data);
    },
  },
  methods: {
    handleTap() {
      this.triggerEvent('select', { model: this.data.model });
    },
    handleImgLoad() {
      this.setData({ imgLoaded: true });
    },
    handleImgError() {
      this.setData({ imgError: true, imgLoaded: true });
    },
    handleFavToggle() {
      this.triggerEvent('togglefavorite', { id: this.data.model.id });
    },
    preventBubble() {},
  },
});
