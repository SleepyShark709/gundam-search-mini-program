import { Response } from 'express';

const FEATURE_ENV = {
  discovery: 'FEATURE_DISCOVERY',
  sharing: 'FEATURE_SHARING',
  squad: 'FEATURE_SQUAD',
  quiz: 'FEATURE_QUIZ',
  builds: 'FEATURE_BUILDS',
  lineage: 'FEATURE_LINEAGE',
  compare: 'FEATURE_COMPARE',
  pilotRating: 'FEATURE_PILOT_RATING',
} as const;

type FeatureName = keyof typeof FEATURE_ENV;

export function getFeatures(): Record<FeatureName, boolean> {
  return Object.fromEntries(Object.entries(FEATURE_ENV).map(([name, env]) => [name, (process.env[env] ?? 'true') === 'true'])) as Record<FeatureName, boolean>;
}

export function requireFeature(name: FeatureName, res: Response): boolean {
  if (getFeatures()[name]) return true;
  res.status(403).json({ code: 'FEATURE_DISABLED', error: '该功能暂未开放' });
  return false;
}

export function requireShareKind(kind: unknown, res: Response): boolean {
  if (kind === 'squad' || kind === 'quiz' || kind === 'compare') return requireFeature(kind, res);
  if (kind === 'report') return requireFeature('builds', res);
  return true;
}
