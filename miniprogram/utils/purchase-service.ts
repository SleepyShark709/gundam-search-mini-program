import { callAPI } from './api';
import { PurchaseRecord } from './types';

let cachedPurchases: PurchaseRecord[] = [];
let cacheLoaded = false;

/** 将 ISO 日期时间字符串截取为 YYYY-MM-DD 格式 */
function normalizeDate(d: string | null): string | null {
  if (!d) return null;
  // 处理 "2025-11-11T00:00:00.000Z" 或 "2025-11-11" 等格式
  return d.slice(0, 10);
}

export async function loadPurchases(): Promise<PurchaseRecord[]> {
  try {
    const res = await callAPI<{ purchases: PurchaseRecord[] }>({
      path: '/api/purchases',
      method: 'GET',
    });
    cachedPurchases = (res.purchases || []).map((p) => ({
      ...p,
      purchaseDate: normalizeDate(p.purchaseDate),
    }));
    cacheLoaded = true;
    return cachedPurchases;
  } catch (e) {
    console.error('Failed to load purchases', e);
    return cachedPurchases;
  }
}

export function getPurchases(): PurchaseRecord[] {
  return cachedPurchases;
}

export function isPurchased(modelId: string): boolean {
  return cachedPurchases.some((p) => p.modelId === modelId);
}

export function getPurchaseRecord(modelId: string): PurchaseRecord | undefined {
  return cachedPurchases.find((p) => p.modelId === modelId);
}

export async function addPurchase(data: {
  modelId: string;
  priceCny?: number | null;
  purchaseDate?: string | null;
  channel?: string | null;
  note?: string | null;
}): Promise<boolean> {
  try {
    await callAPI({
      path: '/api/purchases',
      method: 'POST',
      data,
    });
    // 重新加载缓存以获取完整记录
    await loadPurchases();
    return true;
  } catch (e) {
    console.error('Failed to add purchase', e);
    return false;
  }
}

export async function updatePurchase(
  modelId: string,
  data: {
    priceCny?: number | null;
    purchaseDate?: string | null;
    channel?: string | null;
    note?: string | null;
  },
): Promise<boolean> {
  try {
    await callAPI({
      path: `/api/purchases/${modelId}`,
      method: 'PUT',
      data,
    });
    // 重新加载缓存以获取更新后的记录
    await loadPurchases();
    return true;
  } catch (e) {
    console.error('Failed to update purchase', e);
    return false;
  }
}

export async function removePurchase(modelId: string): Promise<boolean> {
  const backup = cachedPurchases;
  cachedPurchases = cachedPurchases.filter((p) => p.modelId !== modelId);

  try {
    await callAPI({
      path: `/api/purchases/${modelId}`,
      method: 'DELETE',
    });
    return true;
  } catch (e) {
    cachedPurchases = backup;
    console.error('Failed to remove purchase', e);
    return false;
  }
}
