import { callAPI, isNetworkError } from './api';
import { PurchaseRecord } from './types';

let cachedPurchases: PurchaseRecord[] = [];
let loadingPurchases: Promise<boolean> | null = null;
let revision = 0;
const changedIds = new Map<string, number>();
const pendingChanges = new Map<string, Promise<boolean>>();
let latestRead: { revision: number; purchases: PurchaseRecord[] } | null = null;

type PurchaseFields = Partial<Pick<PurchaseRecord, 'priceCny' | 'purchaseDate' | 'channel' | 'note'>>;

/** 将 ISO 日期时间字符串截取为 YYYY-MM-DD 格式 */
function normalizeDate(d: string | null): string | null {
  if (!d) return null;
  // 处理 "2025-11-11T00:00:00.000Z" 或 "2025-11-11" 等格式
  return d.slice(0, 10);
}

export function loadPurchases(): Promise<boolean> {
  if (loadingPurchases) return loadingPurchases;
  const readRevision = revision;
  loadingPurchases = (async () => {
    try {
      const res = await callAPI<{ purchases: PurchaseRecord[] }>({
        path: '/api/purchases',
        method: 'GET',
      });
      const purchases = (res.purchases || []).map((p) => ({
        ...p,
        purchaseDate: normalizeDate(p.purchaseDate),
      }));
      latestRead = { revision: readRevision, purchases };
      const protectedIds = new Set(pendingChanges.keys());
      changedIds.forEach((version, id) => {
        if (version > readRevision) protectedIds.add(id);
      });
      cachedPurchases = [
        ...purchases.filter((p) => !protectedIds.has(p.modelId)),
        ...cachedPurchases.filter((p) => protectedIds.has(p.modelId)),
      ];
      return true;
    } catch (e) {
      console.error('Failed to load purchases', e);
      return false;
    }
  })().finally(() => { loadingPurchases = null; });
  return loadingPurchases;
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

function queueChange(modelId: string, change: () => Promise<boolean>): Promise<boolean> {
  const previous = pendingChanges.get(modelId);
  const request = (previous ? previous.then(change) : change()).then((success) => {
    if (success) {
      changedIds.set(modelId, ++revision);
    } else if (latestRead && (changedIds.get(modelId) || 0) <= latestRead.revision) {
      const record = latestRead.purchases.find((p) => p.modelId === modelId);
      cachedPurchases = cachedPurchases.filter((p) => p.modelId !== modelId);
      if (record) cachedPurchases.unshift(record);
    }
    return success;
  }).finally(() => {
    if (pendingChanges.get(modelId) === request) pendingChanges.delete(modelId);
  });
  pendingChanges.set(modelId, request);
  return request;
}

function cachePurchase(modelId: string, data: PurchaseFields) {
  const existing = getPurchaseRecord(modelId);
  const now = new Date().toISOString();
  const record: PurchaseRecord = {
    modelId, priceCny: null, purchaseDate: null, channel: null, note: null,
    createdAt: now, ...existing, updatedAt: now,
  };
  if (data.priceCny !== undefined) record.priceCny = data.priceCny;
  if (data.purchaseDate !== undefined) record.purchaseDate = normalizeDate(data.purchaseDate);
  if (data.channel !== undefined) record.channel = data.channel;
  if (data.note !== undefined) record.note = data.note;
  cachedPurchases = [record, ...cachedPurchases.filter((p) => p.modelId !== modelId)];
}

async function verifyChange(modelId: string, data?: PurchaseFields): Promise<boolean> {
  const res = await callAPI<{ purchases: PurchaseRecord[] }>({ path: '/api/purchases', method: 'GET' });
  const record = (res.purchases || []).find((p) => p.modelId === modelId);
  changedIds.set(modelId, ++revision);
  if (record) {
    cachedPurchases = [
      { ...record, purchaseDate: normalizeDate(record.purchaseDate) },
      ...cachedPurchases.filter((p) => p.modelId !== modelId),
    ];
  } else {
    cachedPurchases = cachedPurchases.filter((p) => p.modelId !== modelId);
  }
  if (!data) return !record;
  if (!record) return false;
  return (data.priceCny === undefined || record.priceCny === data.priceCny)
    && (data.purchaseDate === undefined || normalizeDate(record.purchaseDate) === normalizeDate(data.purchaseDate))
    && (data.channel === undefined || record.channel === data.channel)
    && (data.note === undefined || record.note === data.note);
}

function savePurchase(modelId: string, data: PurchaseFields, method: 'POST' | 'PUT'): Promise<boolean> {
  return queueChange(modelId, async () => {
    try {
      await callAPI({
        path: method === 'POST' ? '/api/purchases' : `/api/purchases/${modelId}`,
        method,
        data: method === 'POST' ? { ...data, modelId } : data,
      });
      // 写接口只返回 success；已提交字段可立即更新缓存，无需依赖后续 GET。
      cachePurchase(modelId, data);
      return true;
    } catch (e) {
      if (isNetworkError(e)) {
        try {
          return await verifyChange(modelId, data);
        } catch (readError) {
          console.error('Failed to verify purchase change', readError);
        }
      }
      console.error('Failed to save purchase', e);
      return false;
    }
  });
}

export function addPurchase(data: PurchaseFields & { modelId: string }): Promise<boolean> {
  return savePurchase(data.modelId, data, 'POST');
}

export function updatePurchase(modelId: string, data: PurchaseFields): Promise<boolean> {
  return savePurchase(modelId, data, 'PUT');
}

export function removePurchase(modelId: string): Promise<boolean> {
  return queueChange(modelId, async () => {
    const backup = getPurchaseRecord(modelId);
    cachedPurchases = cachedPurchases.filter((p) => p.modelId !== modelId);
    try {
      await callAPI({ path: `/api/purchases/${modelId}`, method: 'DELETE' });
      return true;
    } catch (e) {
      if (isNetworkError(e)) {
        try {
          return await verifyChange(modelId);
        } catch (readError) {
          console.error('Failed to verify purchase removal', readError);
        }
      }
      if (backup) cachedPurchases = [backup, ...cachedPurchases.filter((p) => p.modelId !== modelId)];
      console.error('Failed to remove purchase', e);
      return false;
    }
  });
}
