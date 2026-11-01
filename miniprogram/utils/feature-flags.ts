import { callAPI } from './api';

export const FEATURE_KEYS = ['discovery', 'sharing', 'squad', 'quiz', 'builds', 'lineage', 'compare', 'pilotRating'] as const;
export type FeatureKey = typeof FEATURE_KEYS[number];
export type Features = Record<FeatureKey, boolean>;
const CLOSED: Features = { discovery: false, sharing: false, squad: false, quiz: false, builds: false, lineage: false, compare: false, pilotRating: false };
let features: Features = { ...CLOSED };
let revision = 0;
let pending: Promise<Features> | null = null;
const listeners = new Set<(value: Features) => void>();

export function getFeatures(): Features { return { ...features }; }
export function featureRevision(): number { return revision; }
export function isFeatureEnabled(key: FeatureKey): boolean { return features[key]; }
export function subscribeFeatures(listener: (value: Features) => void): () => void {
  listeners.add(listener);
  listener(getFeatures());
  return () => { listeners.delete(listener); };
}
function publish(value: Features) {
  features = value;
  revision++;
  listeners.forEach((listener) => listener(getFeatures()));
}

/** 不持久化开关；每次前台确认前先关闭，旧服务端和异常响应都安全降级。 */
export function refreshFeatures(): Promise<Features> {
  if (pending) return pending;
  publish({ ...CLOSED });
  pending = (async () => {
    try {
      const response = await callAPI<{ version: number; features: Features }>({ path: '/api/features', method: 'GET' });
      if (!response || response.version !== 1 || !response.features || FEATURE_KEYS.some((key) => typeof response.features[key] !== 'boolean')) throw new Error('无效功能配置');
      publish(Object.fromEntries(FEATURE_KEYS.map((key) => [key, response.features[key]])) as Features);
    } catch {
      publish({ ...CLOSED });
    }
    return getFeatures();
  })().finally(() => { pending = null; });
  return pending;
}

export class FeatureUnavailableError extends Error {
  constructor(readonly kind?: string) { super('功能暂未开放'); }
}
export function requireFeature(key: FeatureKey, expectedRevision = revision): void {
  if (!features[key] || expectedRevision !== revision) throw new FeatureUnavailableError();
}
export function canShareKind(kind: string): boolean {
  if (!features.sharing) return false;
  if (kind === 'wishlist' || kind === 'purchased') return true;
  const key = kind === 'report' ? 'builds' : kind;
  return ['squad', 'quiz', 'compare'].includes(kind) || kind === 'report'
    ? features[key as FeatureKey] : false;
}
