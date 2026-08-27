/**
 * 오토타일 signature 테이블 — 이웃 조합과 타일 슬롯의 대응.
 *
 * 룰타일 v3 파이프라인의 3단계다. v2의 `ruleTileLayout.ts`가 "그림의 어느 칸이 무슨
 * 역할인가"라는 **위치 기반** 표였다면, 여기서는 "어떤 이웃 조합이 몇 번 타일인가"라는
 * **관계 기반** 표를 쓴다. 미리보기와 유니티 Rule Tile이 같은 표를 참조하므로
 * 둘의 동작이 구조적으로 일치한다.
 *
 * ## 정규화(reduce)
 * 대각 이웃은 인접한 두 변이 **모두** 오버레이일 때만 의미가 있다(그때만 오목 코너가
 * 생긴다). 그 외의 대각 비트는 그림에 영향을 주지 않으므로 버린다. 표준 blob 규칙이다.
 *
 * - 4비트 축약(대각 완전 무시): 16종 → `4x4` 그리드(16슬롯)에 정확히 대응
 * - blob 축약(위 규칙): 47종 → `8x8` 그리드(64슬롯)에 대응, 남는 17슬롯은 변형 타일
 *
 * 47종 유도: 변 조합 16가지에 대해 유효 대각 수 d를 세고 2^d를 합하면
 * 1 + 4 + (4x2) + 2 + (4x4) + 16 = 47.
 *
 * ## 변형(variant) 타일이 계약을 깨지 않는 이유
 * 변형은 **경계 흔들림 시드만** 다르다. 흔들림은 타일 변에서 0이므로(edgeProfile.ts)
 * 변 위의 지형 판정은 변형과 무관하게 동일하다. 즉 어떤 변형을 놓아도 이웃과 맞물린다.
 * 유니티 Rule Tile의 Output: Random 으로 이 변형들을 묶어 쓰면 반복 리듬이 완화된다.
 */

import { NEIGHBOR } from './edgeProfile';
import { TilemapGridLayout } from '../../types/tilemap';

/** 변 비트만 추출하는 마스크 */
const SIDE_MASK = NEIGHBOR.N | NEIGHBOR.E | NEIGHBOR.S | NEIGHBOR.W;

/**
 * 8비트 raw signature를 blob 정규형으로 축약한다.
 * 인접 두 변이 모두 오버레이인 대각 비트만 남긴다.
 */
export function reduceToBlob(signature: number): number {
  let out = signature & SIDE_MASK;
  const has = (b: number) => (signature & b) !== 0;
  if (has(NEIGHBOR.N) && has(NEIGHBOR.E)) out |= signature & NEIGHBOR.NE;
  if (has(NEIGHBOR.S) && has(NEIGHBOR.E)) out |= signature & NEIGHBOR.SE;
  if (has(NEIGHBOR.S) && has(NEIGHBOR.W)) out |= signature & NEIGHBOR.SW;
  if (has(NEIGHBOR.N) && has(NEIGHBOR.W)) out |= signature & NEIGHBOR.NW;
  return out;
}

/** 8비트 raw signature를 4비트(변만) 정규형으로 축약한다. */
export function reduceToSides(signature: number): number {
  return signature & SIDE_MASK;
}

/** 그리드에 맞는 축약 함수 */
export function reduceSignature(signature: number, grid: TilemapGridLayout): number {
  return grid === '8x8' ? reduceToBlob(signature) : reduceToSides(signature);
}

/** 4비트 정규형 16종 (오름차순) */
export const SIGNATURES_4BIT: number[] = (() => {
  const set = new Set<number>();
  for (let s = 0; s < 256; s++) set.add(reduceToSides(s));
  return [...set].sort((a, b) => a - b);
})();

/** blob 정규형 47종 (오름차순) */
export const SIGNATURES_BLOB: number[] = (() => {
  const set = new Set<number>();
  for (let s = 0; s < 256; s++) set.add(reduceToBlob(s));
  return [...set].sort((a, b) => a - b);
})();

/**
 * 8x8 그리드의 남는 슬롯(64 - 47 = 17)을 배정할 signature 우선순위.
 * 실제 맵에서 가장 자주 등장하는 순서 — 사방이 오버레이인 채움 타일이 압도적으로 많고,
 * 그 다음이 직선 엣지, 볼록 코너다.
 */
const VARIANT_PRIORITY: number[] = [
  // 완전 채움 (사방 + 사대각 전부 오버레이)
  0xff,
  // 직선 엣지 4종 (한 변만 베이스, 나머지 대각은 유효한 것 전부 오버레이)
  reduceToBlob(0xff & ~(NEIGHBOR.N | NEIGHBOR.NE | NEIGHBOR.NW)),
  reduceToBlob(0xff & ~(NEIGHBOR.S | NEIGHBOR.SE | NEIGHBOR.SW)),
  reduceToBlob(0xff & ~(NEIGHBOR.W | NEIGHBOR.NW | NEIGHBOR.SW)),
  reduceToBlob(0xff & ~(NEIGHBOR.E | NEIGHBOR.NE | NEIGHBOR.SE)),
  // 볼록 코너 4종 (인접 두 변이 베이스)
  reduceToBlob(NEIGHBOR.S | NEIGHBOR.E | NEIGHBOR.SE),
  reduceToBlob(NEIGHBOR.S | NEIGHBOR.W | NEIGHBOR.SW),
  reduceToBlob(NEIGHBOR.N | NEIGHBOR.E | NEIGHBOR.NE),
  reduceToBlob(NEIGHBOR.N | NEIGHBOR.W | NEIGHBOR.NW),
];

/** 한 슬롯이 담는 내용: 어떤 signature의 몇 번째 변형인가 */
export interface SlotSpec {
  /** 정규화된 signature */
  signature: number;
  /** 같은 signature 안에서의 변형 번호 (0 = 기본) */
  variant: number;
}

/**
 * 그리드별 슬롯 배치표를 만든다.
 * 앞쪽에 정규 signature 전체를 오름차순으로 깔고, 남는 슬롯에 변형을 라운드로빈 배정한다.
 */
export function buildSlotTable(grid: TilemapGridLayout): SlotSpec[] {
  const signatures = grid === '8x8' ? SIGNATURES_BLOB : SIGNATURES_4BIT;
  const totalSlots = grid === '8x8' ? 64 : 16;
  const slots: SlotSpec[] = signatures.map((signature) => ({ signature, variant: 0 }));

  // 남는 슬롯에 변형 배정 (우선순위 목록을 순환)
  const variantCount = new Map<number, number>();
  let p = 0;
  while (slots.length < totalSlots && VARIANT_PRIORITY.length > 0) {
    const sig = VARIANT_PRIORITY[p % VARIANT_PRIORITY.length];
    p++;
    const next = (variantCount.get(sig) ?? 0) + 1;
    variantCount.set(sig, next);
    slots.push({ signature: sig, variant: next });
  }

  return slots.slice(0, totalSlots);
}

/** signature → 슬롯 인덱스 조회표 (변형이 있으면 그 목록 전체) */
export function buildSignatureIndex(slots: SlotSpec[]): Map<number, number[]> {
  const index = new Map<number, number[]>();
  slots.forEach((slot, i) => {
    const list = index.get(slot.signature);
    if (list) list.push(i);
    else index.set(slot.signature, [i]);
  });
  return index;
}

/**
 * 맵에서 계산한 raw signature를 슬롯 인덱스로 해석한다.
 * 변형이 여러 개면 `variantPick`으로 결정적으로 고른다(같은 맵은 항상 같은 그림).
 *
 * @returns 슬롯 인덱스. 표에 없는 조합이면 -1 (정규화를 거치므로 정상 경로에선 발생하지 않음)
 */
export function signatureToSlot(
  rawSignature: number,
  grid: TilemapGridLayout,
  index: Map<number, number[]>,
  variantPick: number = 0
): number {
  const canonical = reduceSignature(rawSignature, grid);
  const candidates = index.get(canonical);
  if (!candidates || candidates.length === 0) return -1;
  return candidates[((variantPick % candidates.length) + candidates.length) % candidates.length];
}

/** 방향 화살표 (뱃지 라벨용) */
const ARROW: Record<string, string> = {
  N: '↑', E: '→', S: '↓', W: '←',
  NW: '↖', NE: '↗', SW: '↙', SE: '↘',
};

/**
 * signature를 한국어 뱃지 라벨로 옮긴다.
 * v2의 고정 14종 열거형과 달리 모든 조합을 표현할 수 있다.
 *
 * 명명 규칙: 방향은 **베이스가 보이는 쪽**을 가리킨다
 * (예: 위쪽이 베이스인 직선 전환 = "엣지↑").
 */
export function describeSignature(signature: number): string {
  const baseSides: string[] = [];
  if (!(signature & NEIGHBOR.N)) baseSides.push('N');
  if (!(signature & NEIGHBOR.E)) baseSides.push('E');
  if (!(signature & NEIGHBOR.S)) baseSides.push('S');
  if (!(signature & NEIGHBOR.W)) baseSides.push('W');

  const arrows = baseSides.map((s) => ARROW[s]).join('');

  switch (baseSides.length) {
    case 4:
      return '고립';
    case 3: {
      // 오버레이인 한 방향으로 뻗은 끝단
      const open = (['N', 'E', 'S', 'W'] as const).find((s) => !baseSides.includes(s));
      return `끝단${open ? ARROW[open] : ''}`;
    }
    case 2: {
      const [a, b] = baseSides;
      const opposite = (a === 'N' && b === 'S') || (a === 'E' && b === 'W');
      if (opposite) return a === 'N' ? '통로↔' : '통로↕';
      // 인접 두 변이 베이스 = 볼록 코너. 두 방향의 대각으로 표기
      const diag = (['NW', 'NE', 'SW', 'SE'] as const)
        .find((d) => d.includes(a) && d.includes(b));
      return `코너${diag ? ARROW[diag] : arrows}`;
    }
    case 1:
      return `엣지${arrows}`;
    default: {
      // 사방 오버레이 — 대각이 비면 오목 코너
      const concave = (['NW', 'NE', 'SW', 'SE'] as const)
        .filter((d) => !(signature & NEIGHBOR[d]))
        .map((d) => ARROW[d])
        .join('');
      return concave ? `오목${concave}` : '채움';
    }
  }
}

/** 슬롯 라벨 (변형 번호까지 표기) */
export function describeSlot(slot: SlotSpec): string {
  const label = describeSignature(slot.signature);
  return slot.variant > 0 ? `${label} 변형${slot.variant}` : label;
}

/** 순수 베이스 지형 타일의 파일명 (그리드 슬롯 밖에서 별도로 내보낸다) */
export const BASE_TILE_FILENAME = 'tile_base.png';
