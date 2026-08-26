import { useCallback, useEffect, useRef, useState } from 'react';
import { PixelArtGridLayout } from '../types/pixelart';
import {
  TilemapGridLayout,
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
}: UseTilemapProcessingOptions) {
  // sheetId → 분할 타일 dataURL[] (휘발성 캐시, 저장 안 함)
  const [tileCache, setTileCache] = useState<Map<string, string[]>>(new Map());
  const [proposal, setProposal] = useState<TilemapReplacementProposal | null>(null);
  // 교체 대상 슬롯 — handleGenerate 클로저의 stale 참조를 피하기 위해 ref로 유지
  const pendingReplaceSlotsRef = useRef<number[]>([]);

  const grid: TilemapGridLayout = isTilemapGridLayout(pixelArtGrid) ? pixelArtGrid : '4x4';

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
      if (!cancelled && restored.size > 0) {
        setTileCache((prev) => new Map([...prev, ...restored]));
      }
    })();

    return () => { cancelled = true; };
    // sheets 배열 길이 변화 시에만 재실행 (신규 시트는 processNewSheet가 즉시 캐시함)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, tilemapData?.sheets.length, tilemapData?.grid]);

  /** slotAssignments를 타일 dataURL 배열로 해석 */
  const currentTiles: (string | null)[] = (() => {
    if (!enabled || !tilemapData) return [];
    return tilemapData.slotAssignments.map((a) => {
      const tiles = tileCache.get(a.sheetId);
      return tiles?.[a.cellIndex] ?? null;
    });
  })();

  /** 교체 재생성 예약: 다음 processNewSheet가 교체 제안 모드로 동작 */
  const requestReplacement = useCallback((slotIndexes: number[]) => {
    pendingReplaceSlotsRef.current = slotIndexes;
  }, []);

  /** 생성 완료된 시트를 후처리 (저장→분할→점수→할당/제안) */
  const processNewSheet = useCallback(async (sheetDataUrl: string) => {
    if (!enabled || !onTilemapDataChange) return;

    const tiles = await sliceTileSheet(sheetDataUrl, grid);
    const scores = await computeSeamScores(tiles);

    const sheetId = `sheet-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    const imageKey = `tilemap-sheet-${sheetId}`;
    await saveImageWithKey(imageKey, sheetDataUrl);
    const sheet: TilemapSheet = { id: sheetId, imageKey, createdAt: new Date().toISOString() };

    setTileCache((prev) => new Map(prev).set(sheetId, tiles));

    const prevData = tilemapData;
    const gridChanged = !prevData || prevData.grid !== grid;
    const pending = pendingReplaceSlotsRef.current;

    if (gridChanged || pending.length === 0 || !prevData || prevData.slotAssignments.length === 0) {
      // 전체 할당: 새 시트가 슬롯 전체를 채움
      // 그리드가 바뀌었으면 이전 시트 풀은 비운다 (스펙 §8 — 히스토리에는 잔존)
      pendingReplaceSlotsRef.current = [];
      onTilemapDataChange({
        grid,
        sheets: gridChanged ? [sheet] : [...prevData.sheets, sheet],
        slotAssignments: tiles.map((_, i) => ({
          slotIndex: i,
          sheetId,
          cellIndex: i,
          seamScore: scores[i],
        })),
      });
      return;
    }

    // 교체 제안: 새 시트에서 점수 상위 셀을 선택 슬롯 수만큼 배정 (락 슬롯 제외)
    const lockedSlots = new Set(
      prevData.slotAssignments.filter((a) => a.locked).map((a) => a.slotIndex)
    );
    const targets = pending.filter((s) => !lockedSlots.has(s));
    const ranked = scores
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
  }, [enabled, onTilemapDataChange, grid, tilemapData]);

  /** 교체 제안 확정: 해당 슬롯만 갱신 + 시트 풀에 추가 */
  const confirmProposal = useCallback(() => {
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
  }, [proposal, tilemapData, onTilemapDataChange]);

  /** 교체 제안 파기: 저장했던 시트 이미지도 정리 */
  const discardProposal = useCallback(async () => {
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
  }, [proposal]);

  /** 슬롯 락 토글 (교체 보호) */
  const toggleLock = useCallback((slotIndex: number) => {
    if (!tilemapData || !onTilemapDataChange) return;
    onTilemapDataChange({
      ...tilemapData,
      slotAssignments: tilemapData.slotAssignments.map((a) =>
        a.slotIndex === slotIndex ? { ...a, locked: !a.locked } : a
      ),
    });
  }, [tilemapData, onTilemapDataChange]);

  return {
    grid,
    currentTiles,
    proposal,
    processNewSheet,
    requestReplacement,
    confirmProposal,
    discardProposal,
    toggleLock,
  };
}
