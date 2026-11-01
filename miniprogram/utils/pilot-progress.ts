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
