import { Features, FeatureKey, subscribeFeatures } from './feature-flags';

interface FeaturePage { setData(data: Record<string, unknown>): void }
const subscriptions = new WeakMap<FeaturePage, () => void>();

export function bindPageFeatures(page: FeaturePage, key?: FeatureKey, onChange?: (enabled: boolean, features: Features) => void): void {
  if (subscriptions.has(page)) return;
  const unsubscribe = subscribeFeatures((features) => {
    const enabled = key ? features[key] : true;
    page.setData({ features, ...(key ? { featureEnabled: enabled } : {}) });
    onChange?.(enabled, features);
  });
  subscriptions.set(page, unsubscribe);
}
export function unbindPageFeatures(page: FeaturePage): void {
  subscriptions.get(page)?.();
  subscriptions.delete(page);
}

/** 驻留页面的订阅回调不能改变当前页面的原生分享菜单。 */
export function isCurrentPage(page: FeaturePage): boolean {
  if (typeof getCurrentPages !== 'function') return false;
  const pages = getCurrentPages();
  return pages[pages.length - 1] === page;
}
