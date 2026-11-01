import type { GundamModel, PurchaseRecord } from './types';
import type { BuildProgress } from './hangar-service';

/** 趣味评级只反映已记录的拼装与收藏探索，不衡量消费能力。 */
export function pilotProgress(purchases: PurchaseRecord[], models: GundamModel[], progress: BuildProgress[]) {
  const ids = new Set(purchases.map((record) => record.modelId));
  const saved = new Map(progress.filter((record) => ids.has(record.modelId)).map((record) => [record.modelId, record]));
  const quantity = purchases.reduce((sum, record) => sum + (saved.get(record.modelId)?.quantity || 1), 0);
  const completed = [...saved.values()].reduce((sum, record) => sum + record.completedCount, 0);
  const building = [...saved.values()].reduce((sum, record) => sum + record.buildingCount, 0);
  const documented = purchases.filter((record) => !!(record.note?.trim() || record.purchaseDate)).length;
  const series = new Set(models.filter((model) => ids.has(model.id)).map((model) => model.series)).size;
  const goals = [...saved.values()].filter((record) => !!record.goalDoneDate).length;
  const total = purchases.length;
  const dimensions = [quantity ? completed / quantity : 0, quantity ? (completed + building) / quantity : 0,
    total ? documented / total : 0, series / 4, total ? goals / total : 0];
  const weights = [3, 2, 1, 1, 1];
  const labels = ['完工', '整备', '档案', '探索', '目标'];
  const values = [`${completed}/${quantity}盒`, `${completed + building}/${quantity}盒`, `${documented}/${total}款`, `${series}/4系列`, `${goals}/${total}款`];
  const tips = ['完成一台模型，在机库整备中记录成果', '从堆积中选一台开始整备', '补一段备注或入手日期，留下收藏故事', '探索不同等级的模型，按兴趣收藏', '设定一个小目标，完成后记录下来'];
  const weighted = dimensions.map((value, i) => value * weights[i]);
  const weakest = weighted.indexOf(Math.min(...weighted));
  return {
    dimensions, score: Math.round(weighted.reduce((sum, value) => sum + value, 0) / 8 * 100),
    details: labels.map((label, i) => ({ label, valueText: values[i], percent: Math.round(dimensions[i] * 100) })),
    tip: tips[weakest],
  };
}

/** 保留原收藏面板的五维计算；新增拼装评级使用上面的独立公式。 */
export function collectionRating(purchases: PurchaseRecord[], stats: { totalSpent: number; savedRate: number; seriesCount: number }, now = new Date()) {
  const { totalSpent, savedRate, seriesCount } = stats;
  const since = new Date(now.getFullYear(), now.getMonth() - 3, now.getDate()).toISOString().slice(0, 10);
  const recentCount = purchases.filter((record) => record.purchaseDate && record.purchaseDate >= since).length;
  const dimensions = [Math.min(purchases.length / 20, 1), Math.min(totalSpent / 10000, 1),
    Math.min(Math.max(savedRate, 0) / 25, 1), Math.min(seriesCount / 4, 1), Math.min(recentCount / 6, 1)];
  const weights = [1.5, 1.2, 0.5, 1, 0.8];
  const labels = ['台数', '花费', '省钱', '覆盖', '频率'];
  const money = totalSpent.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const values = [`${purchases.length}/20台`, `¥${money}/¥10,000`, `${Math.max(savedRate, 0).toFixed(0)}%/25%`, `${seriesCount}/4系列`, `${(recentCount / 3).toFixed(1)}/2台·月`];
  const weighted = dimensions.map((value, index) => value * weights[index]);
  const tips = ['多入手几台心仪的高达吧', '买买买，花费越高评分越高', '多找折扣渠道，省钱率达 25% 即满分', '尝试不同系列，集齐HG/RG/MG/PG', '保持购买频率，月均2台即满分'];
  return {
    dimensions, score: Math.round(weighted.reduce((sum, value) => sum + value, 0) / 5 * 100),
    details: labels.map((label, index) => ({ label, valueText: values[index], percent: Math.round(dimensions[index] * 100) })),
    tip: tips[weighted.indexOf(Math.min(...weighted))],
  };
}
