import { canShareKind, featureRevision, FeatureUnavailableError, requireFeature } from './feature-flags';
import { callAPI } from './api';
import { resolveImageUrl } from './cdn-config';
import { GundamModel } from './types';

export type ShareKind = 'squad' | 'quiz' | 'wishlist' | 'purchased' | 'compare' | 'report';

export interface ShareInput {
  kind: ShareKind;
  title: string;
  modelIds: string[];
  captainId?: string;
  questions?: { prompt: string; optionIds: string[]; answerId: string }[];
  report?: { quantity: number; completedCount: number; buildingCount: number };
}

export interface ShareSnapshot {
  id: string;
  kind: ShareKind;
  title: string;
  models: GundamModel[];
  captainId?: string;
  questions?: { prompt: string; optionIds: string[] }[];
  report?: { quantity: number; completedCount: number; buildingCount: number };
}

export interface BuildProgress {
  modelId: string;
  quantity: number;
  completedCount: number;
  buildingCount: number;
  goal: string;
  goalDoneDate: string | null;
}

export async function createShare(input: ShareInput): Promise<{ id: string }> {
  if (!canShareKind(input.kind)) throw new FeatureUnavailableError();
  const revision = featureRevision();
  const result = await callAPI<{ id: string }>({ path: '/api/shares', method: 'POST', data: input });
  requireFeature('sharing', revision);
  if (!canShareKind(input.kind)) throw new FeatureUnavailableError();
  return result;
}

export async function getShare(id: string): Promise<ShareSnapshot> {
  requireFeature('sharing');
  const revision = featureRevision();
  const snapshot = await callAPI<ShareSnapshot>({ path: `/api/shares/${encodeURIComponent(id)}`, method: 'GET' });
  requireFeature('sharing', revision);
  if (!snapshot || !canShareKind(snapshot.kind)) throw new FeatureUnavailableError(snapshot?.kind);
  if (!Array.isArray(snapshot.models)) throw new Error('无效分享数据');
  return {
    ...snapshot,
    models: snapshot.models.map((model) => ({
      ...model,
      imageUrl: resolveImageUrl(model.imageUrl),
      ...(model.images ? { images: model.images.map(resolveImageUrl) } : {}),
    })),
  };
}

export async function submitQuiz(id: string, answers: string[]): Promise<{ score: number; total: number; correctAnswers: string[] }> {
  if (!canShareKind('quiz')) throw new FeatureUnavailableError();
  const revision = featureRevision();
  const result = await callAPI<{ score: number; total: number; correctAnswers: string[] }>({ path: `/api/shares/${encodeURIComponent(id)}/answers`, method: 'POST', data: { answers } });
  requireFeature('sharing', revision);
  requireFeature('quiz', revision);
  return result;
}

export async function loadBuildProgress(): Promise<BuildProgress[]> {
  requireFeature('builds');
  const revision = featureRevision();
  const response = await callAPI<{ builds: BuildProgress[] }>({ path: '/api/builds', method: 'GET' });
  requireFeature('builds', revision);
  if (!response || !Array.isArray(response.builds) || !response.builds.every(validBuild)) throw new Error('无效机库数据');
  return response.builds;
}

export async function saveBuildProgress(input: BuildProgress): Promise<BuildProgress> {
  requireFeature('builds');
  const revision = featureRevision();
  const result = await callAPI<BuildProgress>({ path: `/api/builds/${encodeURIComponent(input.modelId)}`, method: 'PUT', data: input });
  requireFeature('builds', revision);
  if (!validBuild(result)) throw new Error('无效机库数据');
  return result;
}

function validBuild(value: BuildProgress): boolean {
  return !!value && typeof value.modelId === 'string' && Number.isInteger(value.quantity) && value.quantity >= 1 && value.quantity <= 999
    && Number.isInteger(value.completedCount) && value.completedCount >= 0
    && Number.isInteger(value.buildingCount) && value.buildingCount >= 0
    && value.completedCount + value.buildingCount <= value.quantity && typeof value.goal === 'string'
    && (value.goalDoneDate === null || typeof value.goalDoneDate === 'string');
}
