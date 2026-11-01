const { loadModule } = require('./load-typescript.cjs');

// Existing page tests exercise their original, enabled behavior; flag transitions
// are covered with the real modules in feature-flags.test.cjs.
function enabledFeatures() {
  const value = Object.fromEntries(['discovery', 'sharing', 'squad', 'quiz', 'builds', 'lineage', 'compare', 'pilotRating'].map((key) => [key, true]));
  const flags = {
    getFeatures: () => ({ ...value }), isFeatureEnabled: () => true,
    canShareKind: () => true, featureRevision: () => 0,
    refreshFeatures: async () => ({ ...value }),
    subscribeFeatures(listener) { listener({ ...value }); return () => {}; },
    FeatureUnavailableError: class extends Error {},
  };
  const page = loadModule('miniprogram/utils/feature-page.ts', { mocks: { './feature-flags': flags }, globals: { wx: {} } }).exports;
  page.isCurrentPage = () => true;
  return { flags, page, mocks: { '../../utils/feature-flags': flags, '../../utils/feature-page': page } };
}
module.exports = { enabledFeatures };
