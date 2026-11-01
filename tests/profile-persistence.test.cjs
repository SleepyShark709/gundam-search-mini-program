const assert = require('node:assert/strict');
const test = require('node:test');
const { loadModule } = require('./helpers/load-typescript.cjs');

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

const flush = () => new Promise(setImmediate);
const profile = (fields = {}) => ({
  openid: 'driver-a', nickname: '驾驶员', avatarUrl: 'cloud://avatars/saved.jpg', isAdmin: true, ...fields,
});
const success = (request, data) => request.success({ statusCode: 200, data });
const failure = (request) => request.fail({ errMsg: '网络不可用' });

function session({ storage = new Map(), appId = 'test-mini', envVersion = 'release', storageErrors = {}, upload } = {}) {
  const requests = [];
  const uploads = [];
  const toasts = [];
  const updates = [];
  const loading = [];
  const timers = new Map();
  const quietConsole = { error() {} };
  let timerId = 0;
  const wx = {
    getAccountInfoSync: () => ({ miniProgram: { appId, envVersion } }),
    getWindowInfo: () => ({ statusBarHeight: 20, screenHeight: 800, windowWidth: 375 }),
    getStorageSync(key) {
      if (storageErrors.read) throw new Error('读取 Storage 失败');
      return storage.has(key) ? structuredClone(storage.get(key)) : '';
    },
    setStorageSync(key, value) {
      if (storageErrors.write) throw new Error('写入 Storage 失败');
      storage.set(key, structuredClone(value));
    },
    removeStorageSync(key) {
      if (storageErrors.remove) throw new Error('删除 Storage 失败');
      storage.delete(key);
    },
    request: (options) => requests.push(options),
    cloud: {
      init() {},
      callContainer: (options) => requests.push(options),
      async uploadFile(options) {
        uploads.push(options);
        return upload ? upload(options) : { fileID: 'cloud://avatars/new.jpg' };
      },
    },
    showToast: (toast) => toasts.push(toast),
    showLoading: (options) => loading.push(options),
    hideLoading: () => loading.push('hidden'),
  };
  const api = loadModule('miniprogram/utils/api.ts', {
    globals: {
      wx,
      setTimeout(callback, delay) { const id = ++timerId; timers.set(id, { callback, delay }); return id; },
      clearTimeout: (id) => timers.delete(id),
    },
  }).exports;
  const users = loadModule('miniprogram/utils/user-service.ts', {
    mocks: { './api': api }, globals: { wx, console: quietConsole },
  }).exports;
  const wishlist = { loadWishlist: async () => true, getWishlist: () => ['hg-001'] };
  const purchases = { loadPurchases: async () => true, getPurchases: () => [] };
  let app;
  loadModule('miniprogram/app.ts', {
    mocks: {
      './utils/cloud-favorites': wishlist,
      './utils/purchase-service': purchases,
      './utils/model-service': { refreshSeriesMeta() {} },
      './utils/user-service': users,
    },
    globals: { wx, App(value) { app = { ...value, globalData: structuredClone(value.globalData) }; } },
  });
  const { definition } = loadModule('miniprogram/pages/profile/profile.ts', {
    mocks: {
      '../../utils/cloud-favorites': wishlist,
      '../../utils/purchase-service': purchases,
      '../../utils/user-service': users,
      '../../utils/api': api,
    },
    globals: { wx, getApp: () => app, console: quietConsole },
  });
  const page = {
    ...definition,
    data: structuredClone(definition.data),
    setData(patch) { updates.push(patch); Object.assign(this.data, patch); },
  };
  page.onLoad();
  return { users, app, page, storage, requests, uploads, toasts, updates, loading, timers };
}

async function seed(storage, fields) {
  const current = session({ storage });
  const reading = current.users.loadUserInfo();
  success(current.requests[0], profile(fields));
  assert.equal(await reading, true);
  return current;
}

test('重建真实 TS 模块后立即恢复已确认资料，冷启动失败保留缓存且不标记已同步', async () => {
  const storage = new Map();
  await seed(storage);
  const reopened = session({ storage });
  assert.equal(reopened.page.data.nickname, '驾驶员');
  assert.equal(reopened.page.data.avatarUrl, 'cloud://avatars/saved.jpg');
  assert.equal(reopened.app.globalData.userInfo.nickname, '驾驶员');
  assert.equal(reopened.users.isUserInfoLoaded(), false);
  assert.equal(reopened.users.isCurrentUserAdmin(), false);
  const showing = reopened.page.onShow();
  failure(reopened.requests[0]);
  await showing;
  assert.equal(reopened.app.globalData.userInfoLoaded, false);
  assert.equal(reopened.users.isUserInfoLoaded(), false);
  assert.equal(reopened.page.data.userLoadError, true);
  assert.equal(reopened.page.data.isLoggedIn, true);
  assert.equal(reopened.page.data.nickname, '驾驶员');
  assert.equal(storage.size, 1);
});

test('首次资料 GET 失败后重入重试，App 启动与页面并发仅发一个请求', async () => {
  const current = session();
  const launching = current.app.loadUserInfo();
  const showing = current.page.onShow();
  assert.equal(current.requests.length, 1);
  failure(current.requests[0]);
  await Promise.all([launching, showing]);
  assert.equal(current.users.isUserInfoLoaded(), false);
  assert.equal(current.app.globalData.userInfoLoaded, false);
  assert.equal(current.page.data.hasUserInfo, false);
  assert.equal(current.page.data.userLoadError, true);
  assert.equal(current.page.data.userLoading, false);
  const retrying = current.page.onShow();
  assert.equal(current.page.handleRetry(), retrying);
  assert.equal(current.page.onShow(), retrying);
  assert.equal(current.requests.length, 2);
  success(current.requests[1], profile());
  await retrying;
  assert.equal(current.app.globalData.userInfoLoaded, true);
  assert.equal(current.users.isUserInfoLoaded(), true);
  assert.equal(current.page.data.isLoggedIn, true);
  assert.equal(current.page.data.userLoadError, false);
  assert.equal(current.page.data.userLoading, false);
  assert.equal(current.page.data.nickname, '驾驶员');
  assert.equal(current.page.data.wishlistCount, 1);
});

test('服务端成功返回空资料清除旧缓存，重建模块后不再显示旧昵称头像', async () => {
  const storage = new Map();
  await seed(storage);
  const current = session({ storage });
  const showing = current.page.onShow();
  success(current.requests[0], profile({ nickname: null, avatarUrl: null }));
  await showing;
  assert.equal(current.page.data.userLoadError, false);
  assert.equal(current.page.data.hasUserInfo, false);
  assert.equal(current.page.data.nickname, '');
  assert.equal(current.page.data.tempAvatarUrl, '');
  assert.equal(current.users.getCurrentOpenid(), 'driver-a');
  assert.equal(storage.size, 0);
  assert.equal(session({ storage }).users.getUserInfo(), null);
});

test('远端确认换 openid 后覆盖旧账号缓存，空资料也不保留旧账号头像', async () => {
  const storage = new Map();
  await seed(storage);
  const current = session({ storage });
  let reading = current.users.loadUserInfo();
  success(current.requests[0], profile({ openid: 'driver-b', nickname: null, avatarUrl: null }));
  await reading;
  assert.equal(current.users.getCurrentOpenid(), 'driver-b');
  assert.equal(current.users.getUserInfo(), null);
  assert.equal(storage.size, 0);
  reading = current.users.loadUserInfo();
  success(current.requests[1], profile({ openid: 'driver-b', nickname: '新账号', avatarUrl: null }));
  await reading;
  const reopened = session({ storage });
  assert.equal(reopened.users.getCurrentOpenid(), 'driver-b');
  assert.equal(reopened.users.getUserInfo().nickname, '新账号');
  assert.equal(reopened.users.getUserInfo().avatarUrl, '');
});

test('上传成功但 POST 失败保留确认资料，临时选择与失败保存均不污染持久缓存', async () => {
  const storage = new Map();
  await seed(storage);
  const oldStorage = structuredClone(Array.from(storage));
  const current = session({ storage });
  current.page.onChooseAvatar({ detail: { avatarUrl: 'wxfile://temporary-avatar' } });
  current.page.onNicknameChange({ detail: { value: '未提交昵称' } });
  assert.deepEqual(Array.from(storage), oldStorage);
  const saving = current.page.saveProfile();
  await flush();
  assert.equal(current.uploads[0].filePath, 'wxfile://temporary-avatar');
  assert.equal(JSON.parse(current.requests[0].data).avatarFileId, 'cloud://avatars/new.jpg');
  current.requests[0].success({ statusCode: 500, data: { error: '保存失败' } });
  await saving;
  assert.equal(current.toasts.at(-1).title, '保存失败');
  assert.equal(current.page.data.saving, false);
  assert.equal(current.page.data.nickname, '驾驶员');
  assert.equal(current.page.data.avatarUrl, 'cloud://avatars/saved.jpg');
  assert.equal(current.users.getUserInfo().nickname, '驾驶员');
  assert.deepEqual(Array.from(storage), oldStorage);
  assert.equal(session({ storage }).page.data.nickname, '驾驶员');
});

for (const rejected of [false, true]) {
  test(`资料保存${rejected ? '抛出异常' : '返回 false'}时结束保存状态且不显示成功`, async () => {
    const current = session();
    current.users.updateUserProfile = async () => {
      if (rejected) throw new Error('保存异常');
      return false;
    };
    current.page.onChooseAvatar({ detail: { avatarUrl: 'wxfile://temporary-avatar' } });
    current.page.onNicknameChange({ detail: { value: '未提交昵称' } });
    await current.page.saveProfile();
    assert.equal(current.page.data.saving, false);
    assert.equal(current.page.data.isLoggedIn, false);
    assert.equal(current.users.getUserInfo(), null);
    assert.equal(current.storage.size, 0);
    assert.equal(current.toasts.at(-1).title, '保存失败');
    assert.equal(current.loading.at(-1), 'hidden');
  });
}

test('资料缓存按 appid 和 develop/trial/release 隔离，身份信息缺失时停用持久化', async () => {
  const storage = new Map();
  await seed(storage);
  assert.equal(session({ storage }).users.getUserInfo().nickname, '驾驶员');
  for (const envVersion of ['trial', 'develop']) {
    assert.equal(session({ storage, envVersion }).users.getUserInfo(), null);
  }
  assert.equal(session({ storage, appId: 'another-mini' }).users.getUserInfo(), null);
  const unknown = session({ storage, appId: '' });
  const reading = unknown.users.loadUserInfo();
  success(unknown.requests[0], profile({ nickname: '未知应用' }));
  assert.equal(await reading, true);
  assert.equal(storage.size, 1);
  assert.equal(session({ storage }).users.getUserInfo().nickname, '驾驶员');
});

test('Storage 读写删除异常不影响远端资料成功与正常空结果', async () => {
  const current = session({ storageErrors: { read: true, write: true, remove: true } });
  let showing = current.page.onShow();
  success(current.requests[0], profile());
  await showing;
  assert.equal(current.page.data.nickname, '驾驶员');
  assert.equal(current.page.data.userLoadError, false);
  assert.equal(current.app.globalData.userInfoLoaded, true);
  showing = current.page.onShow();
  success(current.requests[1], profile({ nickname: null, avatarUrl: null }));
  await showing;
  assert.equal(current.page.data.hasUserInfo, false);
  assert.equal(current.page.data.userLoadError, false);
});

test('迟到旧 GET 不覆盖新 POST 成功资料及持久缓存', async () => {
  const current = session();
  const reading = current.users.loadUserInfo();
  const writing = current.users.updateUserProfile({ nickname: '新昵称', avatarFileId: 'cloud://avatars/new.jpg' });
  success(current.requests[1], profile({ nickname: '新昵称', avatarUrl: 'cloud://avatars/new.jpg' }));
  assert.equal((await writing).nickname, '新昵称');
  success(current.requests[0], profile({ nickname: '旧昵称' }));
  assert.equal(await reading, true);
  assert.equal(current.users.getUserInfo().nickname, '新昵称');
  const reopened = session({ storage: current.storage });
  assert.equal(reopened.users.getUserInfo().nickname, '新昵称');
  assert.equal(reopened.users.getUserInfo().avatarUrl, 'cloud://avatars/new.jpg');
});

test('仅有头像的已确认资料可恢复并补充昵称，cloud fileID 不重复上传', async () => {
  const storage = new Map();
  await seed(storage, { nickname: null });
  const current = session({ storage });
  assert.equal(current.users.getUserInfo().nickname, '');
  assert.equal(current.page.data.hasUserInfo, true);
  assert.equal(current.page.data.isLoggedIn, false);
  assert.equal(current.page.data.tempAvatarUrl, 'cloud://avatars/saved.jpg');
  current.page.onNicknameChange({ detail: { value: '补全昵称' } });
  const saving = current.page.saveProfile();
  assert.equal(current.uploads.length, 0);
  assert.equal(JSON.parse(current.requests[0].data).avatarFileId, 'cloud://avatars/saved.jpg');
  success(current.requests[0], profile({ nickname: '补全昵称' }));
  await saving;
  assert.equal(current.page.data.isLoggedIn, true);
  assert.equal(current.page.data.nickname, '补全昵称');
  assert.equal(current.app.globalData.userInfoLoaded, true);
  assert.equal(session({ storage }).users.getUserInfo().nickname, '补全昵称');
});

test('仅有昵称的资料仍保留，缺失 openid 时不伪造身份或写入本地缓存', async () => {
  const current = session();
  const showing = current.page.onShow();
  success(current.requests[0], profile({ openid: '', avatarUrl: null }));
  await showing;
  assert.equal(current.users.getUserInfo().nickname, '驾驶员');
  assert.equal(current.users.getUserInfo().avatarUrl, '');
  assert.equal(current.users.getCurrentOpenid(), null);
  assert.equal(current.page.data.tempNickname, '驾驶员');
  assert.equal(current.page.data.hasUserInfo, true);
  assert.equal(current.storage.size, 0);
});

test('仅持久化 cloud 头像文件标识，不保存服务端意外返回的临时路径', async () => {
  const current = await seed(new Map(), { avatarUrl: 'wxfile://temporary-avatar' });
  const stored = Array.from(current.storage.values())[0];
  assert.equal(stored.nickname, '驾驶员');
  assert.equal(stored.avatarUrl, '');
  assert.equal(session({ storage: current.storage }).page.data.tempAvatarUrl, '');
});

test('个人页卸载后忽略迟到 GET 的页面更新和后续重试', async () => {
  const current = session();
  const showing = current.page.onShow();
  current.page.onUnload();
  const updateCount = current.updates.length;
  success(current.requests[0], profile());
  await showing;
  await current.page.handleRetry();
  assert.equal(current.updates.length, updateCount);
  assert.equal(current.requests.length, 1);
});

test('头像上传期间卸载不再提交 POST，也不进行页面更新', async () => {
  const uploaded = deferred();
  const current = session({ upload: () => uploaded.promise });
  current.page.onChooseAvatar({ detail: { avatarUrl: 'wxfile://temporary-avatar' } });
  current.page.onNicknameChange({ detail: { value: '驾驶员' } });
  const saving = current.page.saveProfile();
  current.page.onUnload();
  const updateCount = current.updates.length;
  uploaded.resolve({ fileID: 'cloud://avatars/new.jpg' });
  await saving;
  assert.equal(current.requests.length, 0);
  assert.equal(current.storage.size, 0);
  assert.equal(current.updates.length, updateCount);
  assert.equal(current.toasts.length, 0);
  assert.equal(current.loading.at(-1), 'hidden');
});

test('POST 已提交后卸载，成功结果仍持久化且不向卸载页面写入', async () => {
  const current = session();
  current.page.onChooseAvatar({ detail: { avatarUrl: 'wxfile://temporary-avatar' } });
  current.page.onNicknameChange({ detail: { value: '驾驶员' } });
  const saving = current.page.saveProfile();
  await flush();
  current.page.onUnload();
  const updateCount = current.updates.length;
  success(current.requests[0], profile({ avatarUrl: 'cloud://avatars/new.jpg' }));
  await saving;
  assert.equal(current.updates.length, updateCount);
  assert.equal(current.toasts.length, 0);
  assert.equal(session({ storage: current.storage }).users.getUserInfo().avatarUrl, 'cloud://avatars/new.jpg');
});

for (const edited of ['nickname', 'avatar', 'both']) {
  test(`同步期间保留${edited}草稿，同时刷新未编辑字段和已确认资料`, async () => {
    const storage = new Map();
    await seed(storage, { nickname: null });
    const current = session({ storage });
    const showing = current.page.onShow();
    if (edited !== 'avatar') current.page.onNicknameChange({ detail: { value: '草稿昵称' } });
    if (edited !== 'nickname') current.page.onChooseAvatar({ detail: { avatarUrl: 'wxfile://draft-avatar' } });
    success(current.requests[0], profile({ nickname: '远端昵称', avatarUrl: 'cloud://avatars/refreshed.jpg' }));
    await showing;
    assert.equal(current.page.data.tempNickname, edited === 'avatar' ? '远端昵称' : '草稿昵称');
    assert.equal(current.page.data.tempAvatarUrl, edited === 'nickname' ? 'cloud://avatars/refreshed.jpg' : 'wxfile://draft-avatar');
    assert.equal(current.page.data.nickname, '远端昵称');
    assert.equal(current.page.data.avatarUrl, 'cloud://avatars/refreshed.jpg');
    assert.equal(current.page.data.isLoggedIn, false);
    assert.equal(current.app.globalData.userInfo.nickname, '远端昵称');
    const stored = Array.from(storage.values())[0];
    assert.equal(stored.nickname, '远端昵称');
    assert.equal(stored.avatarUrl, 'cloud://avatars/refreshed.jpg');
  });
}

test('用户主动清空昵称也作为草稿保留，不被迟到 GET 重新填入', async () => {
  const storage = new Map();
  await seed(storage, { avatarUrl: null });
  const current = session({ storage });
  const showing = current.page.onShow();
  current.page.onNicknameChange({ detail: { value: '' } });
  success(current.requests[0], profile({ nickname: '新远端昵称', avatarUrl: null }));
  await showing;
  assert.equal(current.page.data.nickname, '新远端昵称');
  assert.equal(current.page.data.tempNickname, '');
  assert.equal(current.page.data.tempAvatarUrl, '');
});

test('成功保存后结束草稿状态，后续未编辑的同步可正常预填最新资料', async () => {
  const storage = new Map();
  await seed(storage, { nickname: null });
  const current = session({ storage });
  current.page.onNicknameChange({ detail: { value: '保存后的昵称' } });
  const saving = current.page.saveProfile();
  success(current.requests[0], profile({ nickname: '保存后的昵称' }));
  await saving;
  assert.equal(current.page.data.isLoggedIn, true);
  assert.equal(current.page.data.tempNickname, '保存后的昵称');
  assert.equal(current.page.data.tempAvatarUrl, 'cloud://avatars/saved.jpg');
  const showing = current.page.onShow();
  success(current.requests[1], profile({ nickname: '后续同步昵称', avatarUrl: 'cloud://avatars/later.jpg' }));
  await showing;
  assert.equal(current.page.data.isLoggedIn, true);
  assert.equal(current.page.data.tempNickname, '后续同步昵称');
  assert.equal(current.page.data.tempAvatarUrl, 'cloud://avatars/later.jpg');
});

for (const remote of ['changed', 'empty', 'same']) {
  test(`POST 失败后协调并发 GET 的 ${remote} 确认资料，保留未提交草稿`, async () => {
    const storage = new Map();
    await seed(storage, { avatarUrl: null });
    const current = session({ storage });
    current.page.onNicknameChange({ detail: { value: '未提交昵称' } });
    current.page.onChooseAvatar({ detail: { avatarUrl: 'wxfile://unsubmitted-avatar' } });
    const saving = current.page.saveProfile();
    await flush();
    const showing = current.page.onShow();
    const confirmed = remote === 'same' ? profile({ avatarUrl: null }) : profile({
      openid: 'driver-b', nickname: remote === 'empty' ? null : '远端已确认昵称', avatarUrl: null,
    });
    success(current.requests[1], confirmed);
    await showing;
    current.requests[0].success({ statusCode: 500, data: { error: 'POST 保存失败' } });
    await saving;
    assert.equal(current.users.getCurrentOpenid(), confirmed.openid);
    assert.equal(current.page.data.nickname, confirmed.nickname || '');
    assert.equal(current.page.data.avatarUrl, '');
    assert.equal(current.page.data.hasUserInfo, remote !== 'empty');
    assert.equal(current.page.data.isLoggedIn, false);
    assert.equal(current.page.data.tempNickname, '未提交昵称');
    assert.equal(current.page.data.tempAvatarUrl, 'wxfile://unsubmitted-avatar');
    assert.equal(current.page.data.userLoadError, false);
    assert.equal(current.page.data.saving, false);
    assert.equal(current.app.globalData.userInfo, current.users.getUserInfo());
    assert.equal(current.app.globalData.userInfoLoaded, true);
    assert.equal(current.toasts.at(-1).title, '保存失败');
    if (remote === 'empty') {
      assert.equal(storage.size, 0);
      assert.equal(current.users.getUserInfo(), null);
    } else {
      const stored = Array.from(storage.values())[0];
      assert.equal(stored.openid, confirmed.openid);
      assert.equal(stored.nickname, confirmed.nickname);
      assert.equal(stored.avatarUrl, '');
    }
  });
}
