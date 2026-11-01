import { SeriesCode } from '../utils/types';

export interface LineageEntry {
  modelId: string;
  variant: string;
  series: SeriesCode;
  productUrl: string;
}

export interface Lineage {
  id: string;
  name: string;
  subtitle: string;
  entries: LineageEntry[];
}

// 精选且人工核对的目录映射。新增产品须逐一核对官方商品页，不使用名称模糊匹配。
export const LINEAGES: Lineage[] = [
  {
    id: 'rx78', name: 'RX-78-2', subtitle: '同一机体，不同年代的模型演绎',
    entries: [
      { modelId: 'rg-001', variant: '初代 RG', series: 'rg', productUrl: 'https://bandai-hobby.net/item/01_2228/' },
      { modelId: 'rg-041', variant: 'RG Ver.2.0', series: 'rg', productUrl: 'https://bandai-hobby.net/item/01_5261/' },
      { modelId: 'mg-027', variant: 'MG Ver.1.5', series: 'mg', productUrl: 'https://bandai-hobby.net/item/01_527/' },
      { modelId: 'mg-135', variant: 'MG Ver.2.0', series: 'mg', productUrl: 'https://bandai-hobby.net/item/01_1453/' },
      { modelId: 'pg-001', variant: '初代 PG', series: 'pg', productUrl: 'https://bandai-hobby.net/item/01_2875/' },
      { modelId: 'pg-029', variant: 'PG UNLEASHED', series: 'pg', productUrl: 'https://bandai-hobby.net/item/01_3328/' },
    ],
  },
  {
    id: 'nu', name: 'ν / Hi-ν', subtitle: '两种 ν 高达设计的模型规格并列',
    entries: [
      { modelId: 'rg-032', variant: 'ν 高达 · RG', series: 'rg', productUrl: 'https://bandai-hobby.net/item/01_2343/' },
      { modelId: 'rg-036', variant: 'Hi-ν 高达 · RG', series: 'rg', productUrl: 'https://bandai-hobby.net/item/01_3524/' },
      { modelId: 'mg-033', variant: 'ν 高达 · MG', series: 'mg', productUrl: 'https://bandai-hobby.net/item/01_887/' },
      { modelId: 'mg-114', variant: 'Hi-ν 高达 · MG', series: 'mg', productUrl: 'https://bandai-hobby.net/item/01_1642/' },
      { modelId: 'pg-031', variant: 'ν 高达 · PG UNLEASHED', series: 'pg', productUrl: 'https://bandai-hobby.net/item/01_6783/' },
    ],
  },
  {
    id: 'rx0', name: 'RX-0 独角兽', subtitle: '一号机、二号机与全装甲装备形态',
    entries: [
      { modelId: 'rg-025', variant: '独角兽 · RG', series: 'rg', productUrl: 'https://bandai-hobby.net/item/01_1085/' },
      { modelId: 'rg-027', variant: '报丧女妖命运女神 · RG', series: 'rg', productUrl: 'https://bandai-hobby.net/item/01_1259/' },
      { modelId: 'rg-030', variant: '全装甲独角兽 · RG', series: 'rg', productUrl: 'https://bandai-hobby.net/item/01_2028/' },
      { modelId: 'mg-173', variant: '独角兽 · MG', series: 'mg', productUrl: 'https://bandai-hobby.net/item/01_5671/' },
      { modelId: 'mg-192', variant: '报丧女妖 · MG', series: 'mg', productUrl: 'https://bandai-hobby.net/item/01_5746/' },
      { modelId: 'pg-019', variant: '独角兽 · PG', series: 'pg', productUrl: 'https://bandai-hobby.net/item/01_237/' },
      { modelId: 'pg-022', variant: '报丧女妖命运女神 · PG', series: 'pg', productUrl: 'https://bandai-hobby.net/item/01_407/' },
    ],
  },
];
