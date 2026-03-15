import { formatJPY, formatCNY, calcTaxFree } from '../../utils/price';

Component({
  options: {
    virtualHost: true,
  },
  properties: {
    price: {
      type: Number,
      value: 0,
    },
    exchangeRate: {
      type: Number,
      value: 0.05,
    },
  },
  data: {
    mainPriceText: '',
    cnyText: '',
    taxFreeText: '',
    isUnknown: false,
  },
  observers: {
    'price, exchangeRate': function (price: number, exchangeRate: number) {
      if (price === 0) {
        this.setData({ isUnknown: true, mainPriceText: '', cnyText: '', taxFreeText: '' });
        return;
      }
      const cnyPrice = price * exchangeRate;
      this.setData({
        isUnknown: false,
        mainPriceText: formatJPY(price),
        cnyText: `≈ ${formatCNY(cnyPrice)}`,
        taxFreeText: `税前 ${formatJPY(calcTaxFree(price))}`,
      });
    },
  },
});
