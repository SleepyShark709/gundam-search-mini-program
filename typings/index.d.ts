/// <reference path="./types/index.d.ts" />

interface IAppOption {
  globalData: {
    exchangeRate: number;
    exchangeRateLoaded: boolean;
    statusBarHeight: number;
    safeAreaBottom: number;
    windowWidth: number;
  };
  loadExchangeRate: () => void;
}