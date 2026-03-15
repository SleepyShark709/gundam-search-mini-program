import { getFavorites } from './favorites';
import { batchAddToWishlist } from './cloud-favorites';

const MIGRATION_FLAG = 'gundam-wishlist-migrated';

export async function migrateToCloudWishlist(): Promise<void> {
  try {
    if (wx.getStorageSync(MIGRATION_FLAG)) return;

    const localFavs = getFavorites();
    if (localFavs.length === 0) {
      wx.setStorageSync(MIGRATION_FLAG, '1');
      return;
    }

    await batchAddToWishlist(localFavs);
    wx.setStorageSync(MIGRATION_FLAG, '1');
  } catch (e) {
    console.error('Migration failed, will retry next launch', e);
  }
}
