import { GundamModel, PurchaseRecord } from './types';
import { LINEAGES, Lineage } from '../data/lineages';

export type DiscoveryMode = 'search' | 'new' | 'lineage' | 'compare';

export function discoveryMode(value?: string): DiscoveryMode {
  return value === 'new' || value === 'lineage' || value === 'compare' ? value : 'search';
}

// 本地目录尚未收录英文全名，只为这些明确的常用名称提供别名。
const ENGLISH_ALIASES: Record<string, string[]> = {
  gundam: ['高达', 'ガンダム'], unicorn: ['独角兽', 'ユニコーン'],
  nu: ['ν'], hinu: ['hiν'], zaku: ['扎古', 'ザク'],
  zeta: ['z高达', 'ゼータ'], sazabi: ['沙扎比', 'サザビー'],
  freedom: ['自由', 'フリーダム'], strike: ['强袭', 'ストライク'],
  destiny: ['命运', 'デスティニー'], banshee: ['报丧女妖', 'バンシィ'],
  barbatos: ['巴巴托斯', 'バルバトス'],
};

function searchText(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number'
    ? String(value).normalize('NFKC').toLowerCase().replace(/[\s\-－‐‑–—_/.·・]+/g, '')
    : '';
}

export function searchCatalog(models: GundamModel[], keyword: string): GundamModel[] {
  const terms = String(keyword || '').trim().split(/\s+/).map(searchText).filter(Boolean);
  if (terms.length === 0) return [...models];
  return models.filter((model) => {
    const fields = [model.id, model.name, model.nameJa, model.nameEn,
      `${model.series}${model.number}`, ...(model.tags || [])].map(searchText);
    return terms.every((term) => [term, ...(Object.prototype.hasOwnProperty.call(ENGLISH_ALIASES, term) ? ENGLISH_ALIASES[term] : [])]
      .some((alias) => fields.some((field) => field.includes(alias))));
  });
}

function releaseKey(value: string): number {
  const match = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(value || '');
  if (!match) return 0;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3] || 1);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    ? date.getTime() : 0;
}

export function recentModels(models: GundamModel[]): GundamModel[] {
  return models.filter((model) => releaseKey(model.releaseDate) > 0)
    .sort((a, b) => releaseKey(b.releaseDate) - releaseKey(a.releaseDate) || a.id.localeCompare(b.id));
}

export function modelFacts(model: GundamModel) {
  const limitedNames = { pbandai: 'PB 限定', gbase: '高达基地限定', event: '活动限定', sidef: 'SIDE-F 限定', other: '其他限定' };
  return {
    ...model,
    grade: model.series.toUpperCase(),
    scale: model.series === 'pg' ? '1/60' : model.series === 'mg' ? '1/100' : '1/144',
    priceText: Number.isFinite(model.price) && model.price > 0 ? `¥${model.price.toLocaleString('en-US')} 日元` : '未收录',
    dateText: model.releaseDate || '未收录',
    limitedText: model.isLimited ? limitedNames[model.limitedType || 'other'] : '普通发售',
  };
}

export function lineageById(id: string): Lineage {
  return LINEAGES.find((lineage) => lineage.id === id) || LINEAGES[0];
}

export function lineageProgress(lineage: Lineage, models: GundamModel[], purchases: PurchaseRecord[], known: boolean) {
  const catalog = new Map(models.map((model) => [model.id, model]));
  const owned = new Set(purchases.map((purchase) => purchase.modelId));
  const mapped = new Set(lineage.entries.filter((entry) => catalog.has(entry.modelId)).map((entry) => entry.modelId));
  const count = [...mapped].filter((id) => owned.has(id)).length;
  return {
    ...lineage,
    total: mapped.size,
    owned: count,
    percent: known && mapped.size ? Math.round(count / mapped.size * 100) : 0,
    progressText: known ? `${count} / ${mapped.size}` : `待同步 / ${mapped.size}`,
    entries: lineage.entries.map((entry) => {
      const model = catalog.get(entry.modelId);
      return {
        ...entry,
        model: model ? modelFacts(model) : null,
        status: !model ? '目录未收录' : !known ? '入手状态待同步' : owned.has(entry.modelId) ? '已入手' : '未入手',
        owned: !!model && known && owned.has(entry.modelId),
      };
    }),
  };
}

export function toggleCompareSelection(ids: string[], id: string): { ids: string[]; full: boolean } {
  const selected = [...new Set(ids)].slice(0, 2);
  if (!id) return { ids: selected, full: false };
  if (selected.includes(id)) return { ids: selected.filter((value) => value !== id), full: false };
  return selected.length === 2 ? { ids: selected, full: true } : { ids: [...selected, id], full: false };
}
