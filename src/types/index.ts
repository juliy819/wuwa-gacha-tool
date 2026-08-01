export interface GachaRecord {
  id?: number;
  player_id: string;
  card_pool_type: string;
  card_pool_name: string;
  card_pool_group: string;
  resource_id: number;
  quality_level: number;
  resource_type: string;
  name: string;
  count: number;
  time: string;
  is_off_rate: boolean;
  is_mock: boolean;
  mock_batch_id: string | null;
}

export interface GachaResource {
  resource_id: number;
  name: string;
  quality_level: number;
  resource_type: 'role' | 'weapon';
}

export interface InsertMockGachaRequest {
  player_id: string;
  card_pool_type: string;
  resource_id: number;
  pulls: number;
  time: string;
}

export interface UpdateMockGachaRequest {
  id: number;
  card_pool_type: string;
  resource_id: number;
  time: string;
}

export interface DeleteMockResult {
  deleted_count: number;
}

export interface GachaImportResult {
  player_id: string;
  records: GachaRecord[];
  imported_count: number;
  added_count: number;
  duplicate_count: number;
  total_count: number;
  failed_pools: string[];
}

export interface RecordSummary {
  player_id: string;
  record_count: number;
  earliest_time: string;
  latest_time: string;
  last_imported_at?: string | null;
  is_inferred?: boolean | null;
}

export interface ClearRecordsResult {
  deleted_count: number;
  backup_path: string | null;
}

export interface PoolInfo {
  pool_type: string;
  pool_name: string;
  count: number;
  five_star_count: number;
  four_star_count: number;
  current_pity: number;
  avg_pity: number;
  max_pity: number;
  off_rate_count: number;
}

export interface GachaStats {
  total_draws: number;
  total_five_star: number;
  total_four_star: number;
  total_three_star: number;
  five_star_rate: number;
  four_star_rate: number;
  limited_five_star: number;
  standard_five_star: number;
  current_pity: number;
  max_pity: number;
  avg_five_star_pity: number;
  win_rate_5050: number;
  off_rate_count: number;
  avg_up_role_pulls: number;
  avg_up_weapon_pulls: number;
  pools: PoolInfo[];
}

export interface GameSettings {
  game_dir: string;
}

export interface GameDirValidation {
  valid: boolean;
  log_path: string;
  message: string;
}

export interface ToastMessage {
  id: string;
  type: 'success' | 'error' | 'info';
  message: string;
}

export const QUALITY = {
  FIVE_STAR: 5,
  FOUR_STAR: 4,
  THREE_STAR: 3,
} as const;

export const QUALITY_COLORS: Record<number, string> = {
  5: '#e8d4a8',
  4: '#b8a8d8',
  3: '#8ab8c8',
};

export const QUALITY_LABELS: Record<number, string> = {
  5: '五星',
  4: '四星',
  3: '三星',
};

// 卡池类型（显示名 → type ID）
export const POOL_TYPES: { name: string; type: string; group: string }[] = [
  { name: '角色活动唤取', type: '1', group: 'UP角色池' },
  { name: '武器活动唤取', type: '2', group: 'UP武器池' },
  { name: '角色常驻唤取', type: '3', group: '常驻角色池' },
  { name: '武器常驻唤取', type: '4', group: '常驻武器池' },
  { name: '新手唤取', type: '5', group: '新手池' },
  { name: '新手自选唤取', type: '6', group: '新手池' },
  { name: '新手自选唤取', type: '7', group: '新手池' },
  { name: '角色新旅唤取', type: '8', group: 'UP角色池' },
  { name: '武器新旅唤取', type: '9', group: 'UP武器池' },
  { name: '角色联动唤取', type: '10', group: 'UP角色池' },
  { name: '武器联动唤取', type: '11', group: 'UP武器池' },
  { name: '角色忆旅唤取', type: '12', group: '忆旅角色池' },
  { name: '武器忆旅唤取', type: '13', group: '忆旅武器池' },
];

// 卡池分组（大类）
export const POOL_GROUPS = [
  'UP角色池',
  'UP武器池',
  '常驻角色池',
  '常驻武器池',
  '新手池',
  '忆旅角色池',
  '忆旅武器池',
] as const;

export type PoolGroup = typeof POOL_GROUPS[number];
