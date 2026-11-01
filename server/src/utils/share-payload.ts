import { RowDataPacket } from 'mysql2';

type ShareKind = 'squad' | 'quiz' | 'wishlist' | 'purchased' | 'compare' | 'report';

interface ShareInput {
  kind: ShareKind;
  title: string;
  modelIds: string[];
  captainId?: string;
  questions?: { prompt: string; optionIds: string[]; answerId: string }[];
  report?: { quantity: number; completedCount: number; buildingCount: number };
}

const KINDS = ['squad', 'quiz', 'wishlist', 'purchased', 'compare', 'report'];
export const MODEL_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,31}$/i;

function validCount(value: unknown, max: number): value is number {
  return Number.isInteger(value) && (value as number) >= 0 && (value as number) <= max;
}

export function parseShareInput(body: any): ShareInput | null {
  if (!body || !KINDS.includes(body.kind) || typeof body.title !== 'string') return null;
  const title = body.title.trim();
  if (!title || title.length > 30 || !Array.isArray(body.modelIds)) return null;
  const modelIds: string[] = body.modelIds;
  const max = body.kind === 'squad' ? 6 : body.kind === 'compare' ? 2 : body.kind === 'quiz' ? 9 : 50;
  if (modelIds.length < 1 || modelIds.length > max || new Set(modelIds).size !== modelIds.length) return null;
  if (modelIds.some((id) => typeof id !== 'string' || !MODEL_ID_PATTERN.test(id))) return null;
  if (body.kind === 'compare' && modelIds.length !== 2) return null;
  const result: ShareInput = { kind: body.kind, title, modelIds: [...modelIds] };
  if (body.captainId !== undefined) {
    if (body.kind !== 'squad' || !modelIds.includes(body.captainId)) return null;
    result.captainId = body.captainId;
  }
  if (body.kind === 'quiz') {
    if (modelIds.length < 3 || !Array.isArray(body.questions) || body.questions.length !== 3) return null;
    result.questions = [];
    for (const question of body.questions) {
      if (!question || typeof question.prompt !== 'string') return null;
      const prompt = question.prompt.trim();
      if (!prompt || prompt.length > 60 || !Array.isArray(question.optionIds) || question.optionIds.length !== 3) return null;
      if (new Set(question.optionIds).size !== 3 || question.optionIds.some((id: unknown) => !modelIds.includes(id as string))) return null;
      if (!question.optionIds.includes(question.answerId)) return null;
      result.questions.push({ prompt, optionIds: [...question.optionIds], answerId: question.answerId });
    }
  }
  if (body.kind === 'report') {
    const report = body.report;
    if (!report || !validCount(report.quantity, 49950) || report.quantity === 0
      || !validCount(report.completedCount, 49950) || !validCount(report.buildingCount, 49950)
      || report.completedCount + report.buildingCount > report.quantity) return null;
    result.report = { quantity: report.quantity, completedCount: report.completedCount, buildingCount: report.buildingCount };
  }
  return result;
}

/** 分享只保留目录的公开字段，永远不复制用户资料或购买记录。 */
export function publicModel(row: RowDataPacket) {
  const tags = typeof row.tags === 'string' ? JSON.parse(row.tags) : row.tags;
  return {
    id: row.id,
    series: row.series,
    number: row.number,
    name: row.name,
    nameJa: row.name_ja,
    ...(row.name_en ? { nameEn: row.name_en } : {}),
    price: row.price,
    priceTaxFree: row.price_tax_free,
    releaseDate: row.release_date || '',
    isLimited: Boolean(row.is_limited),
    ...(row.limited_type ? { limitedType: row.limited_type } : {}),
    imageUrl: row.image_url,
    productUrl: row.product_url,
    ...(Array.isArray(tags) ? { tags: tags.filter((tag): tag is string => typeof tag === 'string') } : {}),
  };
}
