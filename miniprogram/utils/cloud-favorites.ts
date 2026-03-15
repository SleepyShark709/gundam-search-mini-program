import { callAPI } from './api';

let cachedIds: string[] = [];
let cacheLoaded = false;

export async function loadWishlist(): Promise<void> {
  try {
    const res = await callAPI<{ modelIds: string[] }>({
      path: '/api/wishlist',
      method: 'GET',
    });
    cachedIds = res.modelIds || [];
    cacheLoaded = true;
  } catch (e) {
    console.error('Failed to load wishlist', e);
  }
}

export function getWishlist(): string[] {
  return cachedIds;
}

export function isInWishlist(modelId: string): boolean {
  return cachedIds.includes(modelId);
}

export async function addToWishlist(modelId: string): Promise<boolean> {
  if (cachedIds.includes(modelId)) return true;

  // 乐观更新
  cachedIds = [...cachedIds, modelId];

  try {
    await callAPI({
      path: '/api/wishlist',
      method: 'POST',
      data: { modelId },
    });
    return true;
  } catch (e) {
    // 回滚
    cachedIds = cachedIds.filter((id) => id !== modelId);
    console.error('Failed to add to wishlist', e);
    return false;
  }
}

export async function removeFromWishlist(modelId: string): Promise<boolean> {
  if (!cachedIds.includes(modelId)) return true;

  // 乐观更新
  const backup = cachedIds;
  cachedIds = cachedIds.filter((id) => id !== modelId);

  try {
    await callAPI({
      path: `/api/wishlist/${modelId}`,
      method: 'DELETE',
    });
    return true;
  } catch (e) {
    // 回滚
    cachedIds = backup;
    console.error('Failed to remove from wishlist', e);
    return false;
  }
}

export async function toggleWishlist(modelId: string): Promise<boolean> {
  if (isInWishlist(modelId)) {
    await removeFromWishlist(modelId);
    return false;
  } else {
    await addToWishlist(modelId);
    return true;
  }
}

export async function batchAddToWishlist(modelIds: string[]): Promise<number> {
  try {
    const res = await callAPI<{ added: number }>({
      path: '/api/wishlist/batch',
      method: 'POST',
      data: { modelIds },
    });
    // 合并到缓存，去重
    const idSet = new Set(cachedIds);
    for (const id of modelIds) {
      idSet.add(id);
    }
    cachedIds = Array.from(idSet);
    return res.added;
  } catch (e) {
    console.error('Failed to batch add to wishlist', e);
    return 0;
  }
}
