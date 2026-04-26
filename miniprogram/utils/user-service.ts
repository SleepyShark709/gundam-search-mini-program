import { callAPI } from './api';

export interface UserInfo {
  nickname: string;
  avatarUrl: string;
}

let cachedUserInfo: UserInfo | null = null;
let cacheLoaded = false;

export async function loadUserInfo(): Promise<UserInfo | null> {
  try {
    const res = await callAPI<{ nickname: string | null; avatarUrl: string | null }>({
      path: '/api/user/profile',
      method: 'GET',
    });
    if (res.nickname && res.avatarUrl) {
      cachedUserInfo = { nickname: res.nickname, avatarUrl: res.avatarUrl };
    } else {
      cachedUserInfo = null;
    }
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

export async function updateUserProfile(data: {
  nickname?: string;
  avatarFileId?: string;
}): Promise<UserInfo | null> {
  try {
    const res = await callAPI<{ nickname: string; avatarUrl: string }>({
      path: '/api/user/profile',
      method: 'POST',
      data,
    });
    if (res.nickname && res.avatarUrl) {
      cachedUserInfo = { nickname: res.nickname, avatarUrl: res.avatarUrl };
    }
    return cachedUserInfo;
  } catch (e) {
    console.error('Failed to update user profile', e);
    return null;
  }
}
