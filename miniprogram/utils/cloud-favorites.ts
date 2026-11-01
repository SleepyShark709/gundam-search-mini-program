import { callAPI, isNetworkError } from './api';

let cachedIds: string[] = [];
let loadingWishlist: Promise<boolean> | null = null;
let revision = 0;
const changedIds = new Map<string, number>();
const pendingChanges = new Map<string, Promise<boolean>>();
let latestRead: { revision: number; modelIds: string[] } | null = null;

export function loadWishlist(): Promise<boolean> {
  if (loadingWishlist) return loadingWishlist;
  const readRevision = revision;
  loadingWishlist = (async () => {
    try {
      const res = await callAPI<{ modelIds: string[] }>({
        path: '/api/wishlist',
        method: 'GET',
      });
      latestRead = { revision: readRevision, modelIds: res.modelIds || [] };
      const protectedIds = new Set(pendingChanges.keys());
      changedIds.forEach((version, id) => {
        if (version > readRevision) protectedIds.add(id);
      });
      cachedIds = [
        ...(res.modelIds || []).filter((id) => !protectedIds.has(id)),
        ...cachedIds.filter((id) => protectedIds.has(id)),
      ];
      return true;
    } catch (e) {
      console.error('Failed to load wishlist', e);
      return false;
    }
  })().finally(() => { loadingWishlist = null; });
  return loadingWishlist;
}

export function getWishlist(): string[] {
  return cachedIds;
}

export function isInWishlist(modelId: string): boolean {
  return cachedIds.includes(modelId);
}

function setCachedFavorite(modelId: string, isFavorite: boolean) {
  cachedIds = cachedIds.filter((id) => id !== modelId);
  if (isFavorite) cachedIds.push(modelId);
}

function queueChange(modelId: string, change: () => Promise<boolean>): Promise<boolean> {
  const previous = pendingChanges.get(modelId);
  const request = (previous ? previous.then(change) : change()).then((success) => {
    if (success) {
      changedIds.set(modelId, ++revision);
    } else if (latestRead && (changedIds.get(modelId) || 0) <= latestRead.revision) {
      setCachedFavorite(modelId, latestRead.modelIds.includes(modelId));
    }
    return success;
  }).finally(() => {
    if (pendingChanges.get(modelId) === request) pendingChanges.delete(modelId);
  });
  pendingChanges.set(modelId, request);
  return request;
}

async function setFavorite(modelId: string, isFavorite: boolean): Promise<boolean> {
  const previous = isInWishlist(modelId);
  if (previous === isFavorite) return true;
  setCachedFavorite(modelId, isFavorite);

  try {
    await callAPI({
      path: isFavorite ? '/api/wishlist' : `/api/wishlist/${modelId}`,
      method: isFavorite ? 'POST' : 'DELETE',
      data: isFavorite ? { modelId } : undefined,
    });
    return true;
  } catch (e) {
    if (isNetworkError(e)) {
      try {
        const res = await callAPI<{ modelIds: string[] }>({ path: '/api/wishlist', method: 'GET' });
        const actual = (res.modelIds || []).includes(modelId);
        changedIds.set(modelId, ++revision);
        setCachedFavorite(modelId, actual);
        return actual === isFavorite;
      } catch (readError) {
        console.error('Failed to verify wishlist change', readError);
      }
    }
    setCachedFavorite(modelId, previous);
    console.error('Failed to change wishlist', e);
    return false;
  }
}

export function addToWishlist(modelId: string): Promise<boolean> {
  return queueChange(modelId, () => setFavorite(modelId, true));
}

export function removeFromWishlist(modelId: string): Promise<boolean> {
  return queueChange(modelId, () => setFavorite(modelId, false));
}

export async function toggleWishlist(modelId: string): Promise<{ success: boolean; isFavorite: boolean }> {
  const success = await queueChange(modelId, () => setFavorite(modelId, !isInWishlist(modelId)));
  return { success, isFavorite: isInWishlist(modelId) };
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
      changedIds.set(id, ++revision);
    }
    cachedIds = Array.from(idSet);
    return res.added;
  } catch (e) {
    console.error('Failed to batch add to wishlist', e);
    return 0;
  }
}
