// ---- 本地调试开关 ----
// 设为 true 时使用 wx.request 请求本地 server，false 时走云托管
export const USE_LOCAL = false;
export const LOCAL_BASE = 'http://192.168.31.212';

let cloudInited = false;

function ensureCloudInit() {
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
      header: { 'content-type': 'application/json' },
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
