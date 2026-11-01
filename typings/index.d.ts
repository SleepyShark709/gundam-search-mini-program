/// <reference types="miniprogram-api-typings" />

// Canvas 2D follows the WeChat API types without loading browser DOM globals.
type CanvasRenderingContext2D = WechatMiniprogram.CanvasRenderingContext.CanvasRenderingContext2D;

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
