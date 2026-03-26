export type SeriesCode = 'hg' | 'rg' | 'mg' | 'pg';

export type LimitedType = 'pbandai' | 'gbase' | 'event' | 'sidef' | 'other';

export interface GundamModel {
  id: string;
  series: SeriesCode;
  number: number;
  name: string;
  nameJa: string;
  nameEn?: string;
  price: number;
  priceTaxFree: number;
  releaseDate: string;
  isLimited: boolean;
  limitedType?: LimitedType;
  imageUrl: string;
  images?: string[];
  productUrl: string;
  tags?: string[];
}

export interface SeriesMeta {
  code: SeriesCode;
  name: string;
  shortName: string;
  scale: string;
  coverImage: string;
  totalCount: number;
}

export interface FilterConfig {
  keyword?: string;
  releaseDateFrom?: string;
  releaseDateTo?: string;
  numberFrom?: number;
  numberTo?: number;
}

export interface SortConfig {
  field: 'price' | 'releaseDate' | 'number';
  order: 'asc' | 'desc';
}

export interface PurchaseRecord {
  modelId: string;
  priceCny: number | null;
  purchaseDate: string | null;
  channel: string | null;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}
