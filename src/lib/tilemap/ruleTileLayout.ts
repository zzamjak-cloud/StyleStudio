import { TilemapGridLayout } from '../../types/tilemap';

/**
 * 룰타일 셀 역할.
 * 오목(concave) 코너는 base가 보이는 대각 방향으로 명명한다
 * (예: 구멍의 NW 모서리를 담은 셀은 셀의 SE 사분면에 base가 보임 → concave_se).
 */
export type RuleTileRole =
  | 'corner_nw' | 'corner_ne' | 'corner_sw' | 'corner_se'
  | 'edge_n' | 'edge_s' | 'edge_w' | 'edge_e'
  | 'concave_nw' | 'concave_ne' | 'concave_sw' | 'concave_se'
  | 'fill' | 'base';

/** 결과 뷰 뱃지용 한국어 축약 라벨 */
export const RULE_TILE_ROLE_LABELS: Record<RuleTileRole, string> = {
  corner_nw: '코너↖', corner_ne: '코너↗', corner_sw: '코너↙', corner_se: '코너↘',
  edge_n: '엣지↑', edge_s: '엣지↓', edge_w: '엣지←', edge_e: '엣지→',
  concave_nw: '오목↖', concave_ne: '오목↗', concave_sw: '오목↙', concave_se: '오목↘',
  fill: '풀', base: '베이스',
};

/**
 * 4x4 패치 구도의 셀 역할 (행우선 16칸).
 * 오버레이 패치가 캔버스 12.5%~87.5%를 덮으므로 외곽 링=전환, 중앙 2x2=풀.
 */
const ROLES_4X4: RuleTileRole[] = [
  'corner_nw', 'edge_n', 'edge_n', 'corner_ne',
  'edge_w',    'fill',   'fill',   'edge_e',
  'edge_w',    'fill',   'fill',   'edge_e',
  'corner_sw', 'edge_s', 'edge_s', 'corner_se',
];

/**
 * 8x8 도넛 구도의 셀 역할 (행우선 64칸).
 * 외곽 전환은 12.5%~87.5% 경계(외곽 링 셀), 중앙 구멍은 2x2셀(행·열 3~4)에 순수 base,
 * 구멍 전환선은 행·열 2·5 셀을 지난다.
 * 구멍 주변: 북쪽 셀(2,3)(2,4)은 남쪽에 base가 보임 → edge_s 변형,
 * 서쪽 셀(3,2)(4,2)는 동쪽에 base → edge_e 변형 (내곽 엣지는 외곽 반대 방향과 동일 역할).
 */
const ROLES_8X8: RuleTileRole[] = [
  'corner_nw', 'edge_n', 'edge_n', 'edge_n', 'edge_n', 'edge_n', 'edge_n', 'corner_ne',
  'edge_w',    'fill',   'fill',   'fill',   'fill',   'fill',   'fill',   'edge_e',
  'edge_w',    'fill',   'concave_se', 'edge_s', 'edge_s', 'concave_sw', 'fill', 'edge_e',
  'edge_w',    'fill',   'edge_e', 'base',   'base',   'edge_w', 'fill',   'edge_e',
  'edge_w',    'fill',   'edge_e', 'base',   'base',   'edge_w', 'fill',   'edge_e',
  'edge_w',    'fill',   'concave_ne', 'edge_n', 'edge_n', 'concave_nw', 'fill', 'edge_e',
  'edge_w',    'fill',   'fill',   'fill',   'fill',   'fill',   'fill',   'edge_e',
  'corner_sw', 'edge_s', 'edge_s', 'edge_s', 'edge_s', 'edge_s', 'edge_s', 'corner_se',
];

/** 그리드별 룰타일 셀 역할 테이블 (행우선) */
export function getRuleTileRoles(grid: TilemapGridLayout): RuleTileRole[] {
  return grid === '8x8' ? ROLES_8X8 : ROLES_4X4;
}

/**
 * 특정 역할의 셀 인덱스를 고른다. 같은 역할 셀이 여럿이면 variant로 순환 선택.
 * 해당 역할이 세트에 없으면 -1 (호출부에서 fill 등으로 폴백).
 */
export function pickRoleCell(roles: RuleTileRole[], role: RuleTileRole, variant: number = 0): number {
  const candidates: number[] = [];
  for (let i = 0; i < roles.length; i++) {
    if (roles[i] === role) candidates.push(i);
  }
  if (candidates.length === 0) return -1;
  return candidates[((variant % candidates.length) + candidates.length) % candidates.length];
}
