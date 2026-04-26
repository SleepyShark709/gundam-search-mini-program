// ---- 环境自动检测 ----
// 根据小程序运行版本自动选择 API 后端，无需手动切换：
//   develop（开发者工具/真机调试）→ 本地 server
//   trial / release（体验版/正式版）→ 微信云托管
// 如需在开发者工具中临时强制走云托管，把下面 FORCE_USE_CLOUD 改为 true 即可。
const FORCE_USE_CLOUD = false;

function detectUseLocal(): boolean {
  if (FORCE_USE_CLOUD) return false;
  try {
    const info = wx.getAccountInfoSync();
    return info.miniProgram.envVersion === 'develop';
  } catch {
    // 异常时安全降级到云托管
    return false;
  }
}

export const USE_LOCAL = detectUseLocal();
export const LOCAL_BASE = 'http://192.168.31.212';
// 本地调试用的 mock openid（云托管会自动注入真实的 openid，本地需要手动模拟）
const LOCAL_MOCK_OPENID = 'local-dev-user';

let cloudInited = false;

export function ensureCloudInit() {
  if (cloudInited) return;
  wx.cloud.init({ env: 'prod-7gn6i50ma7c135ba', traceUser: true });
  cloudInited = true;
}

interface CallOptions {
  path: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  data?: any;
  timeout?: number;
}

const DEFAULT_TIMEOUT = 5000;

function callLocal<T>(options: CallOptions): Promise<T> {
  const timeout = options.timeout ?? DEFAULT_TIMEOUT;

  return new Promise<T>((resolve, reject) => {
    wx.request({
      url: LOCAL_BASE + options.path,
      method: options.method,
      header: {
        'content-type': 'application/json',
        'X-WX-OPENID': LOCAL_MOCK_OPENID,
      },
      data: options.data,
      timeout,
      success: (res: any) => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res.data as T);
        } else {
          reject(new Error(res.data?.error || `请求失败: ${res.statusCode}`));
        }
      },
      fail: (err: any) => {
        reject(new Error(err.errMsg || '网络请求失败'));
      },
    });
  });
}

function callCloud<T>(options: CallOptions): Promise<T> {
  ensureCloudInit();

  const timeout = options.timeout ?? DEFAULT_TIMEOUT;

  const request = new Promise<T>((resolve, reject) => {
    wx.cloud.callContainer({
      config: {
        env: 'prod-7gn6i50ma7c135ba',
      },
      path: options.path,
      method: options.method,
      header: {
        'X-WX-SERVICE': 'express-v0yz',
        'content-type': 'application/json',
      },
      data: options.data ? JSON.stringify(options.data) : undefined,
      success: (res: any) => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res.data as T);
        } else {
          reject(new Error(res.data?.error || `请求失败: ${res.statusCode}`));
        }
      },
      fail: (err: any) => {
        reject(new Error(err.errMsg || '网络请求失败'));
      },
    });
  });

  const timer = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error(`请求超时 (${timeout}ms)`)), timeout);
  });

  return Promise.race([request, timer]);
}

export function callAPI<T = any>(options: CallOptions): Promise<T> {
  return USE_LOCAL ? callLocal<T>(options) : callCloud<T>(options);
}
