export interface RecordNavigationTarget {
  recordId?: number;
  poolType?: string;
  source?: 'home-pity' | 'home-five-star' | 'analytics' | 'sync-summary' | 'acquisition-trace';
}

export interface RecordNavigationState {
  recordTarget?: RecordNavigationTarget;
}

export const recordsPath = (target: RecordNavigationTarget) => ({
  pathname: '/records',
  state: { recordTarget: target } satisfies RecordNavigationState,
});
