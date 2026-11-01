import { callAPI } from './api';

export interface UserInfo {
  nickname: string;
  avatarUrl: string;
}

interface ProfileResponse {
  openid: string;
  nickname: string | null;
  avatarUrl: string | null;
  isAdmin: boolean;
}

function getProfileStorageKey(): string | null {
  try {
    const { appId, envVersion } = wx.getAccountInfoSync().miniProgram;
    return appId && envVersion ? `gundam-user-profile:v1:${appId}:${envVersion}` : null;
  } catch {
    return null;
  }
}

const PROFILE_STORAGE_KEY = getProfileStorageKey();
let cachedUserInfo: UserInfo | null = null;
let cachedOpenid: string | null = null;
let cachedIsAdmin = false;
let cacheLoaded = false;
let loadingUserInfo: Promise<boolean> | null = null;
let profileRevision = 0;
let pendingUpdates = 0;
let latestRead: { revision: number; profile: ProfileResponse } | null = null;

function persistProfile() {
  if (!PROFILE_STORAGE_KEY) return;
  try {
    const nickname = cachedUserInfo?.nickname || '';
    const avatarUrl = cachedUserInfo?.avatarUrl.startsWith('cloud://') ? cachedUserInfo.avatarUrl : '';
    if (cachedOpenid && (nickname || avatarUrl)) {
      wx.setStorageSync(PROFILE_STORAGE_KEY, { openid: cachedOpenid, nickname, avatarUrl });
    } else {
      wx.removeStorageSync(PROFILE_STORAGE_KEY);
    }
  } catch (_) {}
}

function applyProfile(res: ProfileResponse, persist = true) {
  cachedOpenid = res.openid || null;
  cachedIsAdmin = !!res.isAdmin;
  const nickname = res.nickname || '';
  const avatarUrl = res.avatarUrl || '';
  cachedUserInfo = nickname || avatarUrl ? { nickname, avatarUrl } : null;
  if (persist) persistProfile();
}

if (PROFILE_STORAGE_KEY) {
  try {
    const stored = wx.getStorageSync(PROFILE_STORAGE_KEY);
    if (stored && typeof stored.openid === 'string' && stored.openid
      && typeof stored.nickname === 'string' && typeof stored.avatarUrl === 'string'
      && (!stored.avatarUrl || stored.avatarUrl.startsWith('cloud://'))) {
      // 本地资料用于离线展示，权限和本次同步状态仍由远端确认。
      applyProfile({ ...stored, isAdmin: false }, false);
    }
  } catch (_) {}
}

export function loadUserInfo(): Promise<boolean> {
  if (loadingUserInfo) return loadingUserInfo;
  const readRevision = profileRevision;
  loadingUserInfo = (async () => {
    try {
      const res = await callAPI<ProfileResponse>({
        path: '/api/user/profile',
        method: 'GET',
      });
      latestRead = { revision: readRevision, profile: res };
      if (profileRevision === readRevision && pendingUpdates === 0) applyProfile(res);
      cacheLoaded = true;
      return true;
    } catch (e) {
      console.error('Failed to load user info', e);
      return false;
    }
  })().finally(() => { loadingUserInfo = null; });
  return loadingUserInfo;
}

export function getUserInfo(): UserInfo | null {
  return cachedUserInfo;
}

export function isUserInfoLoaded(): boolean {
  return cacheLoaded;
}

export function isLoggedIn(): boolean {
  return cachedUserInfo !== null;
}

export function getCurrentOpenid(): string | null {
  return cachedOpenid;
}

export function isCurrentUserAdmin(): boolean {
  return cachedIsAdmin;
}

export async function updateUserProfile(data: {
  nickname?: string;
  avatarFileId?: string;
}): Promise<UserInfo | null> {
  pendingUpdates++;
  try {
    const res = await callAPI<ProfileResponse>({
      path: '/api/user/profile',
      method: 'POST',
      data,
    });
    applyProfile(res);
    profileRevision++;
    cacheLoaded = true;
    return cachedUserInfo;
  } catch (e) {
    console.error('Failed to update user profile', e);
    if (pendingUpdates === 1 && latestRead && profileRevision === latestRead.revision) {
      applyProfile(latestRead.profile);
    }
    return null;
  } finally {
    pendingUpdates--;
  }
}
