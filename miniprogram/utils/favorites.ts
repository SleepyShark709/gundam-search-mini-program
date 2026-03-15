const STORAGE_KEY = 'gundam-favorites';
const MIGRATION_KEY = 'gundam-favorites-v2-migrated';

function readFavorites(): string[] {
  try {
    const raw = wx.getStorageSync(STORAGE_KEY);
    if (!raw) return [];
    return raw as string[];
  } catch {
    return [];
  }
}

function writeFavorites(ids: string[]): void {
  try {
    wx.setStorageSync(STORAGE_KEY, ids);
  } catch {}
}

export function getFavorites(): string[] {
  return readFavorites();
}

export function addFavorite(modelId: string): void {
  const ids = readFavorites();
  if (!ids.includes(modelId)) {
    writeFavorites([...ids, modelId]);
  }
}

export function removeFavorite(modelId: string): void {
  const ids = readFavorites();
  writeFavorites(ids.filter((id) => id !== modelId));
}

export function isFavorite(modelId: string): boolean {
  return readFavorites().includes(modelId);
}

export function toggleFavorite(modelId: string): boolean {
  if (isFavorite(modelId)) {
    removeFavorite(modelId);
    return false;
  } else {
    addFavorite(modelId);
    return true;
  }
}

export function migrateFavoritesIfNeeded(): void {
  try {
    if (wx.getStorageSync(MIGRATION_KEY)) return;

    const oldIds = readFavorites();
    if (oldIds.length === 0) {
      wx.setStorageSync(MIGRATION_KEY, '1');
      return;
    }

    try {
      const migrationMap: Record<string, string> = require('../data/id-migration');
      const newIds: string[] = [];
      for (const oldId of oldIds) {
        const newId = migrationMap[oldId];
        newIds.push(newId || oldId);
      }
      writeFavorites(newIds);
    } catch {}

    wx.setStorageSync(MIGRATION_KEY, '1');
  } catch {
    try { wx.setStorageSync(MIGRATION_KEY, '1'); } catch {}
  }
}
