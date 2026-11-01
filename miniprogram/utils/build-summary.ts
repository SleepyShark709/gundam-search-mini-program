import type { BuildProgress } from './hangar-service';

export function localDate(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function summarizeBuilds(records: BuildProgress[]) {
  const quantity = records.reduce((sum, record) => sum + record.quantity, 0);
  const completedCount = records.reduce((sum, record) => sum + record.completedCount, 0);
  const buildingCount = records.reduce((sum, record) => sum + record.buildingCount, 0);
  return {
    quantity, completedCount, buildingCount,
    backlogCount: quantity - completedCount - buildingCount,
    percent: quantity ? Math.round(completedCount / quantity * 100) : 0,
  };
}
