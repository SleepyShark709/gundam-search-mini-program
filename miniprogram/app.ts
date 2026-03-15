import { loadWishlist } from './utils/cloud-favorites';
import { loadPurchases } from './utils/purchase-service';

const sysInfo = wx.getWindowInfo();
const safeArea = sysInfo.safeArea;

App<IAppOption>({
  globalData: {
    exchangeRate: 0.05,
    exchangeRateLoaded: false,
    statusBarHeight: sysInfo.statusBarHeight || 20,
    safeAreaBottom: sysInfo.screenHeight - (safeArea ? safeArea.bottom : sysInfo.screenHeight),
    windowWidth: sysInfo.windowWidth,
  },
  onLaunch() {
    this.loadExchangeRate();
    loadWishlist();
    loadPurchases();
  },
  loadExchangeRate() {
    const STORAGE_KEY = 'gundam-exchange-rate';
    const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
    const FALLBACK_RATE = 0.05;

    try {
      const raw = wx.getStorageSync(STORAGE_KEY);
      if (raw && Date.now() - raw.timestamp < CACHE_TTL_MS) {
        this.globalData.exchangeRate = raw.rate;
        this.globalData.exchangeRateLoaded = true;
        return;
      }
    } catch (e) {}

    wx.request({
      url: 'https://open.er-api.com/v6/latest/JPY',
      success: (res: any) => {
        if (res.statusCode === 200 && res.data && res.data.rates && res.data.rates.CNY) {
          const rate = res.data.rates.CNY;
          this.globalData.exchangeRate = rate;
          this.globalData.exchangeRateLoaded = true;
          try {
            wx.setStorageSync(STORAGE_KEY, { rate, timestamp: Date.now() });
          } catch (e) {}
        }
      },
      fail: () => {
        this.globalData.exchangeRate = FALLBACK_RATE;
        this.globalData.exchangeRateLoaded = true;
      },
    });
  },
});
