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

export function createShare(input: ShareInput): Promise<{ id: string }> {
  return callAPI({ path: '/api/shares', method: 'POST', data: input });
}

export async function getShare(id: string): Promise<ShareSnapshot> {
  const snapshot = await callAPI<ShareSnapshot>({ path: `/api/shares/${encodeURIComponent(id)}`, method: 'GET' });
  return {
    ...snapshot,
    models: snapshot.models.map((model) => ({
      ...model,
      imageUrl: resolveImageUrl(model.imageUrl),
      ...(model.images ? { images: model.images.map(resolveImageUrl) } : {}),
    })),
  };
}

export function submitQuiz(id: string, answers: string[]): Promise<{ score: number; total: number; correctAnswers: string[] }> {
  return callAPI({ path: `/api/shares/${encodeURIComponent(id)}/answers`, method: 'POST', data: { answers } });
}

export async function loadBuildProgress(): Promise<BuildProgress[]> {
  const response = await callAPI<{ builds: BuildProgress[] }>({ path: '/api/builds', method: 'GET' });
  return response.builds;
}

export function saveBuildProgress(input: BuildProgress): Promise<BuildProgress> {
  return callAPI({ path: `/api/builds/${encodeURIComponent(input.modelId)}`, method: 'PUT', data: input });
}
