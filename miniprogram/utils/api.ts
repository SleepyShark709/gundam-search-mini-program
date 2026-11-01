// ---- API 环境选择 ----
// 默认所有版本（含开发者工具/真机调试）均走微信云托管。
// 本地联调时手动将 FORCE_USE_CLOUD 改为 false，并确认 LOCAL_BASE 可达：
//   develop → 本地 server；trial / release → 微信云托管。
const FORCE_USE_CLOUD = true;

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

class NetworkRequestError extends Error {}

export function isNetworkError(error: unknown): boolean {
  return error instanceof NetworkRequestError;
}

function callLocal<T>(options: CallOptions): Promise<T> {
  const timeout = options.method === 'GET'
    ? options.timeout ?? DEFAULT_TIMEOUT
    : options.timeout;

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
        reject(new NetworkRequestError(err.errMsg || '网络请求失败'));
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
        reject(new NetworkRequestError(err.errMsg || '网络请求失败'));
      },
    });
  });

  // 写操作等待 SDK 的最终回调，避免客户端先报失败、服务端随后提交。
  if (options.method !== 'GET') return request;

  let timerId: ReturnType<typeof setTimeout>;
  const timer = new Promise<never>((_, reject) => {
    timerId = setTimeout(() => reject(new Error(`请求超时 (${timeout}ms)`)), timeout);
  });

  return Promise.race([request, timer]).finally(() => clearTimeout(timerId));
}

export function callAPI<T = any>(options: CallOptions): Promise<T> {
  return USE_LOCAL ? callLocal<T>(options) : callCloud<T>(options);
}
