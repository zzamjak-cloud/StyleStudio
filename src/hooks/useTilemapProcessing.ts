import { useCallback, useEffect, useRef, useState } from 'react';
import { PixelArtGridLayout } from '../types/pixelart';
import {
  TilemapGridLayout,
  TilemapMode,
  TilemapSessionData,
  TilemapSheet,
  TilemapEdgeStyle,
  TilemapOutline,
  isTilemapGridLayout,
} from '../types/tilemap';
import { sliceTileSheet } from '../lib/tilemap/tileSlicer';
import { buildRuleTileSet, COMPOSER_VERSION } from '../lib/tilemap/ruleTileComposer';
import { composeFinalSheet } from '../lib/tilemap/tilemapExporter';
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
  edgeStyle?: TilemapEdgeStyle; // 룰타일: 경계선 모양 프리셋
  outline?: TilemapOutline; // 룰타일: 경계 아웃라인
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
  edgeStyle,
  outline,
}: UseTilemapProcessingOptions) {
  // sheetId → 타일 dataURL[] (휘발성 캐시, 저장 안 함)
  // variation은 시트 분할 결과, ruletile은 머티리얼 시트에서 합성한 결과다
  const [tileCache, setTileCache] = useState<Map<string, string[]>>(new Map());
  // 룰타일 전용: sheetId → 순수 베이스 지형 타일 (그리드 슬롯 밖의 17번째 타일)
  const [baseTileCache, setBaseTileCache] = useState<Map<string, string>>(new Map());
  /**
   * 룰타일 전용: sheetId → 머티리얼 시트 dataURL (메모리 캐시).
   *
   * 경계선 프리셋/아웃라인을 바꿀 때마다 imageStorage를 다시 읽지 않도록 원본을 들고 있는다.
   * 이게 있어야 설정 변경이 **체감상 즉시** 반영된다(IndexedDB 왕복 제거).
   */
  const materialSheetsRef = useRef<Map<string, string>>(new Map());
  /** 경계 설정 변경으로 재합성 중인지 (결과 뷰 표시용) */
  const [isRecomposing, setIsRecomposing] = useState(false);
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

  // 아웃라인은 객체라 매 렌더 새 참조일 수 있으므로 내용 기반 키로 의존성을 건다
  const outlineKey = outline
    ? `${outline.enabled ? 1 : 0}|${outline.thicknessPx}|${outline.color}`
    : '';

  // 세션 재진입 시: 저장된 시트를 로드해 캐시 복원
  useEffect(() => {
    if (!enabled || !tilemapData || tilemapData.sheets.length === 0) return;
    let cancelled = false;

    // 보유 데이터의 모드를 따른다 (패널의 "다음 생성 목표" 모드가 아니다)
    const restoreMode: TilemapMode = tilemapData.mode ?? 'variation';

    (async () => {
      const restored = new Map<string, string[]>();
      const restoredBase = new Map<string, string>();
      for (const sheet of tilemapData.sheets) {
        try {
          const dataUrl = await loadImage(sheet.imageKey);
          if (!dataUrl) {
            logger.warn('⚠️ 타일 시트 이미지 미발견:', sheet.imageKey);
            continue;
          }
          if (restoreMode === 'ruletile') {
            // 룰타일은 자르지 않고 머티리얼 시트에서 다시 합성한다.
            // 원본 시트를 메모리에 캐시해 두면 이후 경계 설정 변경 시 재합성이 즉시 된다
            materialSheetsRef.current.set(sheet.id, dataUrl);
            const set = await buildRuleTileSet(dataUrl, tilemapData.grid, {
              edgeStyle: tilemapData.edgeStyle,
              outline: tilemapData.outline,
            });
            restored.set(sheet.id, set.tiles);
            restoredBase.set(sheet.id, set.baseTile);
          } else {
            restored.set(sheet.id, await sliceTileSheet(dataUrl, tilemapData.grid));
          }
        } catch (e) {
          logger.error('❌ 타일 시트 복원 실패:', sheet.id, e);
        }
      }
      // 세션 전환 시 이전 세션의 캐시·제안이 남아있으면 안 되므로 병합이 아닌 교체
      // (다른 세션의 제안이 현재 세션에 잘못 확정되는 사고 방지)
      if (!cancelled) {
        setTileCache(restored);
        setBaseTileCache(restoredBase);
        setProposal(null);
        pendingReplaceSlotsRef.current = [];
      }
    })();

    return () => { cancelled = true; };
    // 시트 정체성(sheetIds)·그리드·모드 변화 시에만 재실행 (신규 시트는 processNewSheet가 즉시 캐시함).
    // 경계 설정 변경은 아래 전용 이펙트가 처리한다 — "저장소에서 복원"과 "설정으로 재합성"은
    // 다른 관심사이고, 한 이펙트에 섞으면 비동기 경합과 의존성 추적이 얽힌다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, sheetIds, tilemapData?.grid, tilemapData?.mode]);

  /**
   * 경계선 프리셋·아웃라인이 바뀌면 **캐시된 머티리얼 시트로 즉시 재합성**한다.
   * 생성 API를 다시 부르지 않는다 — 합성은 로컬 연산(세트 전체 약 0.5초)이다.
   */
  useEffect(() => {
    if (!enabled || !tilemapData) return;
    if ((tilemapData.mode ?? 'variation') !== 'ruletile') return;
    if (tilemapData.sheets.length === 0) return;
    // 저장된 설정과 같으면 복원 이펙트 결과가 이미 맞다 — 중복 합성 방지
    const storedKey = tilemapData.outline
      ? `${tilemapData.outline.enabled ? 1 : 0}|${tilemapData.outline.thicknessPx}|${tilemapData.outline.color}`
      : '';
    if (tilemapData.edgeStyle === edgeStyle && storedKey === outlineKey) return;

    let cancelled = false;
    // 컬러 피커는 드래그 중 연속으로 값을 쏘므로 살짝 디바운스한다
    const timer = setTimeout(() => {
      (async () => {
        setIsRecomposing(true);
        try {
          const nextTiles = new Map<string, string[]>();
          const nextBase = new Map<string, string>();
          for (const sheet of tilemapData.sheets) {
            const dataUrl =
              materialSheetsRef.current.get(sheet.id) ?? (await loadImage(sheet.imageKey));
            if (!dataUrl) continue;
            materialSheetsRef.current.set(sheet.id, dataUrl);
            const set = await buildRuleTileSet(dataUrl, tilemapData.grid, { edgeStyle, outline });
            nextTiles.set(sheet.id, set.tiles);
            nextBase.set(sheet.id, set.baseTile);
          }
          if (cancelled) return;
          setTileCache(nextTiles);
          setBaseTileCache(nextBase);
        } catch (e) {
          logger.error('❌ 경계 설정 재합성 실패:', e);
        } finally {
          if (!cancelled) setIsRecomposing(false);
        }
      })();
    }, 120);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, edgeStyle, outlineKey, sheetIds, tilemapData?.mode, tilemapData?.grid]);

  // 보유 세트가 룰타일인데 저장된 경계 설정이 패널 선택과 다르면 세션에 반영한다.
  // (즉시 재합성은 위 이펙트가 하고, 이건 재진입 시 마지막 선택을 되살리기 위한 영속화다.
  //  반영 후에는 값이 같아져 이 이펙트가 다시 실행되지 않는다)
  useEffect(() => {
    if (!enabled || !onTilemapDataChange || !tilemapData) return;
    if ((tilemapData.mode ?? 'variation') !== 'ruletile') return;
    if (tilemapData.slotAssignments.length === 0) return;
    const storedKey = tilemapData.outline
      ? `${tilemapData.outline.enabled ? 1 : 0}|${tilemapData.outline.thicknessPx}|${tilemapData.outline.color}`
      : '';
    if (tilemapData.edgeStyle === edgeStyle && storedKey === outlineKey) return;
    onTilemapDataChange({ ...tilemapData, edgeStyle, outline });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, edgeStyle, outlineKey, tilemapData?.mode, sheetIds]);

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

  /**
   * 생성 완료된 시트를 후처리 (저장→분할/합성→점수→할당/제안).
   *
   * @returns 슬롯 전체가 확정된 경우 자동 내보내기용 payload, 교체 제안 대기 상태면 `null`.
   *   상태 반영은 비동기이므로(`onTilemapDataChange` → 리렌더) 호출부가 `currentTiles`를
   *   바로 읽을 수 없다. 그래서 확정 타일을 직접 돌려준다.
   */
  const processNewSheet = useCallback(async (
    sheetDataUrl: string
  ): Promise<{ tiles: string[]; baseTile: string | null; grid: TilemapGridLayout; mode: TilemapMode } | null> => {
    if (!enabled || !onTilemapDataChange) return null;

    const isRuletile = mode === 'ruletile';
    // 룰타일: 시트를 자르지 않고 머티리얼 시트로 해석해 타일을 절차적으로 합성한다
    // variation: 기존과 동일하게 그리드 분할
    let tiles: string[];
    let baseTile: string | null = null;
    if (isRuletile) {
      const set = await buildRuleTileSet(sheetDataUrl, grid, { edgeStyle, outline });
      tiles = set.tiles;
      baseTile = set.baseTile;
    } else {
      tiles = await sliceTileSheet(sheetDataUrl, grid);
    }
    // 룰타일은 이음새를 계약으로 보장하므로 휴리스틱 점수가 의미 없다 — 계산 생략
    const scores = isRuletile ? undefined : await computeSeamScores(tiles);

    const sheetId = `sheet-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    const imageKey = `tilemap-sheet-${sheetId}`;
    await saveImageWithKey(imageKey, sheetDataUrl);
    const sheet: TilemapSheet = { id: sheetId, imageKey, createdAt: new Date().toISOString() };

    setTileCache((prev) => new Map(prev).set(sheetId, tiles));
    if (baseTile) setBaseTileCache((prev) => new Map(prev).set(sheetId, baseTile));
    // 경계 설정 변경 시 imageStorage를 다시 읽지 않도록 머티리얼 시트를 메모리에 캐시
    if (isRuletile) materialSheetsRef.current.set(sheetId, sheetDataUrl);

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
        composerVersion: isRuletile ? COMPOSER_VERSION : undefined,
        edgeStyle: isRuletile ? edgeStyle : undefined,
        outline: isRuletile ? outline : undefined,
        sheets: setChanged ? [sheet] : [...prevData.sheets, sheet],
        slotAssignments: tiles.map((_, i) => ({
          slotIndex: i,
          sheetId,
          cellIndex: i,
          seamScore: scores?.[i],
        })),
      });
      // 전체 할당은 곧바로 최종 상태이므로 자동 내보내기 대상이다
      return { tiles, baseTile, grid, mode };
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
    // 교체 제안은 사용자가 확정해야 최종 상태가 된다 — 자동 내보내기 대상 아님
    return null;
  }, [enabled, onTilemapDataChange, grid, tilemapData, mode, baseTerrain, overlayTerrain, edgeStyle, outline]);

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

  /**
   * 내보내기와 동일한 합성 시트.
   * 결과 뷰의 "시트 보기"가 이 값을 쓴다 — AI 원본 시트를 띄우면 실제 산출물
   * (`tilesheet.png`)과 다르게 보인다(특히 룰타일은 원본이 머티리얼 시트라 완전히 다름).
   */
  const [composedSheet, setComposedSheet] = useState<string | null>(null);
  const tilesKey = currentTiles.map((t) => (t ? t.length : 0)).join(',');
  useEffect(() => {
    if (!enabled) return;
    const tiles = currentTiles;
    if (tiles.length === 0 || tiles.some((t) => t === null)) {
      setComposedSheet(null);
      return;
    }
    let cancelled = false;
    composeFinalSheet(tiles as string[], displayGrid)
      .then((sheet) => { if (!cancelled) setComposedSheet(sheet); })
      .catch((e) => logger.error('❌ 시트 재합성 실패:', e));
    return () => { cancelled = true; };
    // currentTiles는 매 렌더 새 배열이므로 내용 기반 키로 의존성을 건다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, tilesKey, displayGrid]);

  /** 룰타일 순수 베이스 지형 타일 — 그리드 슬롯 밖의 별도 타일 */
  const baseTile: string | null = (() => {
    if (!enabled || effectiveMode !== 'ruletile' || !tilemapData) return null;
    const lastSheet = tilemapData.sheets[tilemapData.sheets.length - 1];
    return lastSheet ? baseTileCache.get(lastSheet.id) ?? null : null;
  })();

  /**
   * 보유한 룰타일 세트가 현재 합성 알고리즘보다 오래됐는지.
   * v2 이전(그림을 잘라 만든 세트)은 `composerVersion`이 없으므로 여기서 걸린다.
   */
  const needsRecompose =
    effectiveMode === 'ruletile' &&
    !!tilemapData &&
    tilemapData.slotAssignments.length > 0 &&
    tilemapData.composerVersion !== COMPOSER_VERSION;

  return {
    grid,
    displayGrid,
    effectiveMode,
    currentTiles,
    baseTile,
    composedSheet,
    isRecomposing,
    needsRecompose,
    proposal,
    processNewSheet,
    requestReplacement,
    confirmProposal,
    discardProposal,
    toggleLock,
  };
}
