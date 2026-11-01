export interface SquadDraft {
  version: 1;
  title: string;
  modelIds: string[];
  captainId: string;
}

const DRAFT_KEY = 'gundam-squad-draft-v1';

export function isSquadDraft(value: unknown): value is SquadDraft {
  if (!value || typeof value !== 'object') return false;
  const draft = value as SquadDraft;
  return draft.version === 1 && typeof draft.title === 'string' && draft.title.length <= 30
    && Array.isArray(draft.modelIds) && draft.modelIds.length <= 6
    && draft.modelIds.every((id) => typeof id === 'string' && id.length > 0 && id.length <= 100)
    && new Set(draft.modelIds).size === draft.modelIds.length
    && typeof draft.captainId === 'string'
    && (draft.modelIds.length === 0 ? draft.captainId === '' : draft.modelIds.includes(draft.captainId));
}

export function loadSquadDraft(): { draft: SquadDraft | null; error: boolean } {
  try {
    const value: unknown = wx.getStorageSync(DRAFT_KEY);
    if (!value) return { draft: null, error: false };
    return isSquadDraft(value) ? { draft: value, error: false } : { draft: null, error: true };
  } catch {
    return { draft: null, error: true };
  }
}

export function saveSquadDraft(draft: SquadDraft): boolean {
  if (!isSquadDraft(draft)) return false;
  try {
    wx.setStorageSync(DRAFT_KEY, draft);
    return true;
  } catch {
    return false;
  }
}
