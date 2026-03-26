import { GundamModel, SeriesMeta, SeriesCode, FilterConfig, SortConfig } from './types';
import { resolveImageUrl } from './cdn-config';
import { callAPI } from './api';

// ---- 缓存配置 ----
const CACHE_TTL = 4 * 60 * 60 * 1000; // 4 小时
const CACHE_KEY_META = 'gundam-cache-meta';
const CACHE_KEY_MODELS_PREFIX = 'gundam-cache-models-';

interface CacheEntry<T> {
  data: T;
  version: string;
  timestamp: number;
}

// ---- Storage 缓存辅助 ----
function readCache<T>(key: string): T | null {
  try {
    const entry: CacheEntry<T> = wx.getStorageSync(key);
    if (!entry || !entry.data) return null;
    if (Date.now() - entry.timestamp > CACHE_TTL) return null;
    return entry.data;
  } catch {
    return null;
  }
}

function writeCache<T>(key: string, data: T, version: string): void {
  try {
    wx.setStorageSync(key, { data, version, timestamp: Date.now() } as CacheEntry<T>);
  } catch {}
}

// ---- L1 内存缓存 ----

// 系列元信息：优先从内存 → Storage → 本地 JSON
let metaCache: SeriesMeta[] | null = null;

// 模型数据：按系列缓存
const modelsCache: Partial<Record<SeriesCode, GundamModel[]>> = {};

// ---- 本地 JSON 加载（L3 兜底） ----

function loadLocalMeta(): SeriesMeta[] {
  return require('../data/series-meta');
}

function loadLocalModels(code: string): GundamModel[] {
  const validCodes = ['hg', 'rg', 'mg', 'pg'];
  if (!validCodes.includes(code)) return [];
  try {
    const content = wx.getFileSystemManager().readFileSync(`/data/${code}.json`, 'utf-8') as string;
    const models: GundamModel[] = JSON.parse(content);
    models.forEach(m => {
      if (m.imageUrl) m.imageUrl = resolveImageUrl(m.imageUrl);
    });
    return models;
  } catch (e) {
    console.error('Failed to load models for', code, e);
    return [];
  }
}

// ---- 同步读取方法（保留原有签名） ----

export function getSeriesMeta(): SeriesMeta[] {
  // L1
  if (metaCache) return metaCache;
  // L2
  const cached = readCache<SeriesMeta[]>(CACHE_KEY_META);
  if (cached) {
    metaCache = cached;
    return cached;
  }
  // L3
  metaCache = loadLocalMeta();
  return metaCache;
}

export function getModels(seriesCode: SeriesCode): GundamModel[] {
  // L1
  if (modelsCache[seriesCode]) return modelsCache[seriesCode]!;
  // L2
  const cached = readCache<GundamModel[]>(CACHE_KEY_MODELS_PREFIX + seriesCode);
  if (cached) {
    modelsCache[seriesCode] = cached;
    return cached;
  }
  // L3
  modelsCache[seriesCode] = loadLocalModels(seriesCode);
  return modelsCache[seriesCode]!;
}

export function getAllModels(): GundamModel[] {
  return [...getModels('hg'), ...getModels('rg'), ...getModels('mg'), ...getModels('pg')];
}

// ---- 异步刷新方法（新增） ----

/**
 * 异步从 API 刷新系列元信息
 * 成功则更新 L1 + L2 缓存并返回新数据
 * 失败则静默降级返回当前缓存
 */
export async function refreshSeriesMeta(): Promise<SeriesMeta[]> {
  try {
    const res = await callAPI<{ data: SeriesMeta[]; version: string }>({
      path: '/api/series-meta',
      method: 'GET',
    });
    if (res.data && res.data.length > 0) {
      metaCache = res.data;
      writeCache(CACHE_KEY_META, res.data, res.version);
      return res.data;
    }
  } catch (e) {
    console.error('[refreshSeriesMeta] failed, using fallback', e);
  }
  return getSeriesMeta();
}

/**
 * 异步从 API 刷新指定系列的模型列表
 * 成功则更新 L1 + L2 缓存并返回新数据
 * 失败则静默降级返回当前缓存
 */
export async function refreshModels(code: SeriesCode): Promise<GundamModel[]> {
  try {
    const res = await callAPI<{ data: GundamModel[]; version: string }>({
      path: `/api/models/${code}`,
      method: 'GET',
    });
    if (res.data && res.data.length > 0) {
      // API 返回的图片 URL 可能需要 CDN 重写
      const models = res.data.map(m => ({
        ...m,
        imageUrl: m.imageUrl ? resolveImageUrl(m.imageUrl) : m.imageUrl,
      }));
      modelsCache[code] = models;
      writeCache(CACHE_KEY_MODELS_PREFIX + code, models, res.version);
      return models;
    }
  } catch (e) {
    console.error(`[refreshModels:${code}] failed, using fallback`, e);
  }
  return getModels(code);
}

/**
 * 异步获取模型的多图列表（按需调用，不缓存到 Storage）
 * 返回空数组时前端降级为单图
 */
export async function getModelImages(seriesCode: SeriesCode, modelId: string): Promise<string[]> {
  try {
    const res = await callAPI<{ images: string[] }>({
      path: `/api/models/${seriesCode}/${modelId}/images`,
      method: 'GET',
    });
    if (res.images && res.images.length > 0) {
      return res.images.map(url => resolveImageUrl(url)).filter(Boolean);
    }
  } catch (e) {
    console.error(`[getModelImages:${modelId}] failed`, e);
  }
  return [];
}

// ---- 筛选和排序（保持不变） ----

export function filterModels(models: GundamModel[], filter: FilterConfig): GundamModel[] {
  return models.filter((model) => {
    if (filter.keyword) {
      const kw = filter.keyword.toLowerCase();
      const nameMatch =
        model.name.toLowerCase().includes(kw) ||
        (model.nameJa ? model.nameJa.toLowerCase().includes(kw) : false) ||
        (model.nameEn ? model.nameEn.toLowerCase().includes(kw) : false) ||
        (model.tags ? model.tags.some((t) => t.toLowerCase().includes(kw)) : false);
      if (!nameMatch) return false;
    }

    if (filter.releaseDateFrom) {
      if (model.releaseDate < filter.releaseDateFrom) return false;
    }
    if (filter.releaseDateTo) {
      if (model.releaseDate > filter.releaseDateTo) return false;
    }
    if (filter.numberFrom !== undefined) {
      if (model.number < filter.numberFrom) return false;
    }
    if (filter.numberTo !== undefined) {
      if (model.number > filter.numberTo) return false;
    }

    return true;
  });
}

export function sortModels(models: GundamModel[], sort: SortConfig): GundamModel[] {
  const sorted = [...models];
  sorted.sort((a, b) => {
    let comparison = 0;
    if (sort.field === 'price') {
      comparison = a.price - b.price;
    } else if (sort.field === 'releaseDate') {
      comparison = a.releaseDate.localeCompare(b.releaseDate);
    } else if (sort.field === 'number') {
      comparison = a.number - b.number;
    }
    return sort.order === 'asc' ? comparison : -comparison;
  });
  return sorted;
}
