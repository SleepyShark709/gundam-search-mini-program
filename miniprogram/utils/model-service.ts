import { GundamModel, SeriesMeta, SeriesCode, FilterConfig, SortConfig } from './types';
import { resolveImageUrl } from './cdn-config';

// Import series meta eagerly (small file)
const seriesMetaData: SeriesMeta[] = require('../data/series-meta');

// Lazy-load model data per series
const modelsCache: Partial<Record<SeriesCode, GundamModel[]>> = {};

function loadModels(code: string): GundamModel[] {
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

export function getSeriesMeta(): SeriesMeta[] {
  return seriesMetaData;
}

export function getModels(seriesCode: SeriesCode): GundamModel[] {
  if (!modelsCache[seriesCode]) {
    modelsCache[seriesCode] = loadModels(seriesCode);
  }
  return modelsCache[seriesCode]!;
}

export function getAllModels(): GundamModel[] {
  return [...getModels('hg'), ...getModels('rg'), ...getModels('mg'), ...getModels('pg')];
}

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
