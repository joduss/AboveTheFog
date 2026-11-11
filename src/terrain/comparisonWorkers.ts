export const ComparisonWorkers = import.meta.env.DEV || import.meta.env.MODE==='comparison'
  ? (await import('./workerPool')).TerrainWorkers : undefined;
