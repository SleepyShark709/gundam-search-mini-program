/// <reference path="./types/index.d.ts" />

interface IAppOption {
  globalData: {
    exchangeRate: number;
    exchangeRateLoaded: boolean;
    statusBarHeight: number;
    safeAreaBottom: number;
    windowWidth: number;
    userInfo: { nickname: string; avatarUrl: string } | null;
    userInfoLoaded: boolean;
  };
  loadExchangeRate: () => void;
  loadUserInfo: () => Promise<void>;
}