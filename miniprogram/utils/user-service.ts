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

let cachedUserInfo: UserInfo | null = null;
let cachedOpenid: string | null = null;
let cachedIsAdmin = false;
let cacheLoaded = false;

function applyProfile(res: ProfileResponse) {
  cachedOpenid = res.openid || null;
  cachedIsAdmin = !!res.isAdmin;
  if (res.nickname && res.avatarUrl) {
    cachedUserInfo = { nickname: res.nickname, avatarUrl: res.avatarUrl };
  } else {
    cachedUserInfo = null;
  }
}

export async function loadUserInfo(): Promise<UserInfo | null> {
  try {
    const res = await callAPI<ProfileResponse>({
      path: '/api/user/profile',
      method: 'GET',
    });
    applyProfile(res);
    cacheLoaded = true;
    return cachedUserInfo;
  } catch (e) {
    console.error('Failed to load user info', e);
    cacheLoaded = true;
    return cachedUserInfo;
  }
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
  try {
    const res = await callAPI<ProfileResponse>({
      path: '/api/user/profile',
      method: 'POST',
      data,
    });
    applyProfile(res);
    return cachedUserInfo;
  } catch (e) {
    console.error('Failed to update user profile', e);
    return null;
  }
}
