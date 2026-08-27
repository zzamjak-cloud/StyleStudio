import { useCallback, useEffect, useRef, useState } from 'react';
import { PixelArtGridLayout } from '../types/pixelart';
import {
  TilemapGridLayout,
  TilemapMode,
  TilemapSessionData,
  TilemapSheet,
  isTilemapGridLayout,
} from '../types/tilemap';
import { sliceTileSheet } from '../lib/tilemap/tileSlicer';
import { computeSeamScores } from '../lib/tilemap/seamValidator';
import { saveImageWithKey, loadImage, deleteImage } from '../lib/imageStorage';
import { logger } from '../lib/logger';

/** 교체 재생성 제안: 새 시트에서 seam 점수 상위 셀을 선택 슬롯에 배정 */
export interface TilemapReplacementProposal {
  sheet: TilemapSheet;
  sheetTiles: string[]; // 새 시트의 분할 타일 (미리보기용)
  replacements: Array<{ slotIndex: number; cellIndex: number; seamScore: number }>;
}

interface UseTilemapProcessingOptions {
  enabled: boolean; // sessionType === 'TILEMAP'
  tilemapData?: TilemapSessionData;
  onTilemapDataChange?: (data: TilemapSessionData) => void;
  pixelArtGrid: PixelArtGridLayout; // 패널의 현재 그리드 선택값
  mode: TilemapMode; // 현재 선택된 타일셋 모드
  baseTerrain?: string; // 룰타일: 베이스 지형 원문 (저장용)
  overlayTerrain?: string; // 룰타일: 오버레이 지형 원문 (저장용)
}

/**
 * 타일맵 생성 후처리 훅.
 * - 시트 저장(imageStorage) → 분할 → seam 점수 → 슬롯 할당/교체 제안
 * - 세션 재진입 시 저장된 시트를 로드·분할해 타일 캐시 복원
 */
export function useTilemapProcessing({
  enabled,
  tilemapData,
  onTilemapDataChange,
  pixelArtGrid,
  mode,
  baseTerrain,
  overlayTerrain,
}: UseTilemapProcessingOptions) {
  // sheetId → 분할 타일 dataURL[] (휘발성 캐시, 저장 안 함)
  const [tileCache, setTileCache] = useState<Map<string, string[]>>(new Map());
  const [proposal, setProposal] = useState<TilemapReplacementProposal | null>(null);
  // 교체 대상 슬롯 — handleGenerate 클로저의 stale 참조를 피하기 위해 ref로 유지
  const pendingReplaceSlotsRef = useRef<number[]>([]);

  const grid: TilemapGridLayout = isTilemapGridLayout(pixelArtGrid) ? pixelArtGrid : '4x4';

  // 보유 타일의 실제 그리드 — 뷰·내보내기는 이 값을 쓴다 (다음 생성 목표 grid와 분리, 스펙 §8)
  const displayGrid: TilemapGridLayout =
    tilemapData && tilemapData.slotAssignments.length > 0 ? tilemapData.grid : grid;

  // 보유 세트의 모드 — displayGrid와 같은 원리로 보유 데이터 우선, 없으면 'variation' 폴백(v1 세션 호환)
  const effectiveMode: TilemapMode = tilemapData?.mode ?? 'variation';

  // 세션 전환 감지를 위한 시트 정체성 (길이만으로는 다른 세션의 동일 개수 시트를 구분 못함)
  const sheetIds = tilemapData?.sheets.map((s) => s.id).join(',') ?? '';

  // 세션 재진입 시: 저장된 시트를 로드해 캐시 복원
  useEffect(() => {
    if (!enabled || !tilemapData || tilemapData.sheets.length === 0) return;
    let cancelled = false;

    (async () => {
      const restored = new Map<string, string[]>();
      for (const sheet of tilemapData.sheets) {
        try {
          const dataUrl = await loadImage(sheet.imageKey);
          if (!dataUrl) {
            logger.warn('⚠️ 타일 시트 이미지 미발견:', sheet.imageKey);
            continue;
          }
          restored.set(sheet.id, await sliceTileSheet(dataUrl, tilemapData.grid));
        } catch (e) {
          logger.error('❌ 타일 시트 복원 실패:', sheet.id, e);
        }
      }
      // 세션 전환 시 이전 세션의 캐시·제안이 남아있으면 안 되므로 병합이 아닌 교체
      // (다른 세션의 제안이 현재 세션에 잘못 확정되는 사고 방지)
      if (!cancelled) {
        setTileCache(restored);
        setProposal(null);
        pendingReplaceSlotsRef.current = [];
      }
    })();

    return () => { cancelled = true; };
    // 시트 정체성(sheetIds) 변화 시에만 재실행 (신규 시트는 processNewSheet가 즉시 캐시함)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, sheetIds, tilemapData?.grid]);

  /** slotAssignments를 타일 dataURL 배열로 해석 */
  const currentTiles: (string | null)[] = (() => {
    if (!enabled || !tilemapData) return [];
    return tilemapData.slotAssignments.map((a) => {
      const tiles = tileCache.get(a.sheetId);
      return tiles?.[a.cellIndex] ?? null;
    });
  })();

  /** 교체 재생성 예약: 다음 processNewSheet가 교체 제안 모드로 동작 (보유 세트가 룰타일이면 이중 방어로 no-op) */
  const requestReplacement = useCallback((slotIndexes: number[]) => {
    if (effectiveMode === 'ruletile') return;
    pendingReplaceSlotsRef.current = slotIndexes;
  }, [effectiveMode]);

  /** 생성 완료된 시트를 후처리 (저장→분할→점수→할당/제안) */
  const processNewSheet = useCallback(async (sheetDataUrl: string) => {
    if (!enabled || !onTilemapDataChange) return;

    const tiles = await sliceTileSheet(sheetDataUrl, grid);
    const isRuletile = mode === 'ruletile';
    // 룰타일은 지형 전환용 역할 고정 세트이므로 이음새 점수가 의미 없다 — 계산 생략
    const scores = isRuletile ? undefined : await computeSeamScores(tiles);

    const sheetId = `sheet-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    const imageKey = `tilemap-sheet-${sheetId}`;
    await saveImageWithKey(imageKey, sheetDataUrl);
    const sheet: TilemapSheet = { id: sheetId, imageKey, createdAt: new Date().toISOString() };

    setTileCache((prev) => new Map(prev).set(sheetId, tiles));

    const prevData = tilemapData;
    // 모드 전환도 그리드 변경과 동일하게 풀 리셋 대상
    const setChanged = !prevData || prevData.grid !== grid || (prevData.mode ?? 'variation') !== mode;
    // 룰타일은 항상 전체 할당(교체 제안 없음) — pending 무시
    const pending = isRuletile ? [] : pendingReplaceSlotsRef.current;

    if (setChanged || pending.length === 0 || !prevData || prevData.slotAssignments.length === 0) {
      // 전체 할당: 새 시트가 슬롯 전체를 채움
      // 그리드/모드가 바뀌었으면 이전 시트 풀은 비운다 (스펙 §8 — 히스토리에는 잔존)
      pendingReplaceSlotsRef.current = [];
      onTilemapDataChange({
        grid,
        mode,
        baseTerrain: mode === 'ruletile' ? baseTerrain : undefined,
        overlayTerrain: mode === 'ruletile' ? overlayTerrain : undefined,
        sheets: setChanged ? [sheet] : [...prevData.sheets, sheet],
        slotAssignments: tiles.map((_, i) => ({
          slotIndex: i,
          sheetId,
          cellIndex: i,
          seamScore: scores?.[i],
        })),
      });
      return;
    }

    // 교체 제안: 새 시트에서 점수 상위 셀을 선택 슬롯 수만큼 배정 (락 슬롯 제외)
    const lockedSlots = new Set(
      prevData.slotAssignments.filter((a) => a.locked).map((a) => a.slotIndex)
    );
    const targets = pending.filter((s) => !lockedSlots.has(s));
    const ranked = (scores ?? [])
      .map((score, cellIndex) => ({ cellIndex, score }))
      .sort((a, b) => b.score - a.score);
    setProposal({
      sheet,
      sheetTiles: tiles,
      replacements: targets.map((slotIndex, k) => ({
        slotIndex,
        cellIndex: ranked[k % ranked.length].cellIndex,
        seamScore: ranked[k % ranked.length].score,
      })),
    });
  }, [enabled, onTilemapDataChange, grid, tilemapData, mode, baseTerrain, overlayTerrain]);

  /** 교체 제안 확정: 해당 슬롯만 갱신 + 시트 풀에 추가 (보유 세트가 룰타일이면 이중 방어로 no-op) */
  const confirmProposal = useCallback(() => {
    if (effectiveMode === 'ruletile') return;
    if (!proposal || !tilemapData || !onTilemapDataChange) return;
    const bySlot = new Map(proposal.replacements.map((r) => [r.slotIndex, r]));
    onTilemapDataChange({
      ...tilemapData,
      sheets: [...tilemapData.sheets, proposal.sheet],
      slotAssignments: tilemapData.slotAssignments.map((a) => {
        const r = bySlot.get(a.slotIndex);
        return r
          ? { ...a, sheetId: proposal.sheet.id, cellIndex: r.cellIndex, seamScore: r.seamScore }
          : a;
      }),
    });
    pendingReplaceSlotsRef.current = [];
    setProposal(null);
  }, [effectiveMode, proposal, tilemapData, onTilemapDataChange]);

  /** 교체 제안 파기: 저장했던 시트 이미지도 정리 (보유 세트가 룰타일이면 이중 방어로 no-op) */
  const discardProposal = useCallback(async () => {
    if (effectiveMode === 'ruletile') return;
    if (!proposal) return;
    try {
      await deleteImage(proposal.sheet.imageKey);
    } catch (e) {
      logger.warn('⚠️ 제안 시트 정리 실패(무시):', e);
    }
    setTileCache((prev) => {
      const next = new Map(prev);
      next.delete(proposal.sheet.id);
      return next;
    });
    pendingReplaceSlotsRef.current = [];
    setProposal(null);
  }, [effectiveMode, proposal]);

  /** 슬롯 락 토글 (교체 보호, 보유 세트가 룰타일이면 이중 방어로 no-op) */
  const toggleLock = useCallback((slotIndex: number) => {
    if (effectiveMode === 'ruletile') return;
    if (!tilemapData || !onTilemapDataChange) return;
    onTilemapDataChange({
      ...tilemapData,
      slotAssignments: tilemapData.slotAssignments.map((a) =>
        a.slotIndex === slotIndex ? { ...a, locked: !a.locked } : a
      ),
    });
  }, [effectiveMode, tilemapData, onTilemapDataChange]);

  return {
    grid,
    displayGrid,
    effectiveMode,
    currentTiles,
    proposal,
    processNewSheet,
    requestReplacement,
    confirmProposal,
    discardProposal,
    toggleLock,
  };
}
