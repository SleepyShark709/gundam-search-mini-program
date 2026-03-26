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

export function callAPI<T = any>(options: CallOptions): Promise<T> {
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
