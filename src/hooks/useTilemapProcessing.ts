import { useCallback, useEffect, useRef, useState } from 'react';
import { PixelArtGridLayout } from '../types/pixelart';
import {
  TilemapGridLayout,
  TilemapMode,
  TilemapSessionData,
  TilemapSheet,
  TilemapEdgeStyle,
  TilemapOutline,
  TilemapOutlineSide,
  isTilemapGridLayout,
} from '../types/tilemap';
import { sliceTileSheet } from '../lib/tilemap/tileSlicer';
import { buildRuleTileSet, COMPOSER_VERSION } from '../lib/tilemap/ruleTileComposer';
import {
  buildVariationTileSet,
  VARIATION_COMPOSER_VERSION,
} from '../lib/tilemap/variationComposer';
import { composeFinalSheet } from '../lib/tilemap/tilemapExporter';
import { saveImageWithKey, loadImage, deleteImage } from '../lib/imageStorage';
import { logger } from '../lib/logger';

interface UseTilemapProcessingOptions {
  enabled: boolean; // sessionType === 'TILEMAP'
  tilemapData?: TilemapSessionData;
  onTilemapDataChange?: (data: TilemapSessionData) => void;
  pixelArtGrid: PixelArtGridLayout; // 패널의 현재 그리드 선택값
  mode: TilemapMode; // 현재 선택된 타일셋 모드
  baseTerrain?: string; // 룰타일: 베이스 지형 원문 (저장용). 빈 값 = 투명
  overlayTerrain?: string; // 룰타일: 오버레이 지형 원문 (저장용). 빈 값 = 투명
  edgeStyle?: TilemapEdgeStyle; // 룰타일: 경계선 모양 프리셋
  outline?: TilemapOutline; // 룰타일: 경계 아웃라인
  outline2?: TilemapOutline; // 룰타일: 보조 아웃라인 (2단계 띠)
  outlineSide?: TilemapOutlineSide; // 룰타일: 아웃라인을 뻗는 방향
}

/**
 * 보유 세트가 **현재 합성 알고리즘으로 만들어졌는지** 판정한다.
 *
 * 두 모드가 서로 다른 합성기를 쓰므로 `composerVersion` 숫자는 모드와 짝으로만
 * 의미가 있다. 값이 없으면 "시트를 잘라 만든" 레거시 세트다.
 */
function isCurrentComposerVersion(data: TilemapSessionData | undefined): boolean {
  if (!data) return false;
  const expected =
    (data.mode ?? 'variation') === 'ruletile' ? COMPOSER_VERSION : VARIATION_COMPOSER_VERSION;
  return data.composerVersion === expected;
}

/**
 * 슬롯이 실제로 가리키는 시트 id 집합.
 *
 * 시트는 생성마다 쌓일 수 있는데, 슬롯이 참조하지 않는 시트는 재구성할 이유가 없다
 * (합성은 시트당 타일 수만큼의 픽셀 루프다). 복원과 경계 설정 재합성이 **같은 기준**을
 * 써야 한다 — 한쪽만 걸러내면 `tileCache`의 키 집합이 어느 이펙트가 마지막으로 돌았는지에
 * 따라 달라진다.
 */
function referencedSheetIds(data: TilemapSessionData): Set<string> {
  return new Set(data.slotAssignments.map((a) => a.sheetId));
}

/** 아직 슬롯이 없는 세션(집합이 비었을 때)은 전부 대상으로 본다 */
function isSheetReferenced(referenced: Set<string>, sheetId: string): boolean {
  return referenced.size === 0 || referenced.has(sheetId);
}

/** 변형 풀이 사실상 1장으로 무너졌으면 알린다 (스와치가 타일보다 작은 경우) */
function warnIfNoVariation(distinctCount: number, slotCount: number): void {
  if (distinctCount >= 2) return;
  logger.warn(
    `⚠️ 재질 스와치가 타일(${slotCount}슬롯)보다 작아 변형을 만들 수 없습니다 — ` +
    '모든 타일이 같은 텍스처가 됩니다(이음새는 없지만 무늬가 반복됩니다).'
  );
}

/**
 * 아웃라인 설정을 내용 기반 문자열 키로 만든다.
 * 아웃라인은 객체라 매 렌더 새 참조일 수 있어, 이펙트 의존성으로 바로 쓸 수 없다.
 * **필드를 추가하면 반드시 여기에도 넣어야 한다** — 빠뜨리면 그 값 변경이 재합성을 트리거하지 못한다.
 */
function makeOutlineKey(
  side: TilemapOutlineSide | undefined,
  ...outlines: Array<TilemapOutline | undefined>
): string {
  return [
    side ?? '',
    ...outlines.map((o) =>
      o ? `${o.enabled ? 1 : 0}|${o.thicknessPx}|${o.color}|${o.opacity ?? 1}` : ''
    ),
  ].join('#');
}

/**
 * 타일맵 생성 후처리 훅.
 * - 시트 저장(imageStorage) → 타일 합성 → 슬롯 전체 할당
 * - 세션 재진입 시 저장된 시트를 로드·재구성해 타일 캐시 복원
 *
 * ## 두 모드 모두 "자르지 않는다"
 * variation·ruletile 모두 AI에게 **재질 스와치**를 받아 타일을 절차적으로 만든다.
 * 그래서 어떤 타일을 어디에 놓아도 접합이 이어진다 — 변 픽셀을 공유하는 엣지 계약이
 * 구성 자체에 들어 있기 때문이다(`seamlessTexture.buildTextureVariants`).
 *
 * 레거시 **변형** 세션(`composerVersion` 없음)만 예외로 `sliceTileSheet` 경로를 유지한다.
 * 그 세션의 시트는 스와치가 아니라 타일 시트라, 합성기에 넣으면 결과가 완전히 달라진다.
 * (룰타일은 버전과 무관하게 지금까지처럼 `buildRuleTileSet`으로 복원한다 — 복원 이펙트 주석 참조)
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
  outline2,
  outlineSide,
}: UseTilemapProcessingOptions) {
  // sheetId → 타일 dataURL[] (휘발성 캐시, 저장 안 함)
  const [tileCache, setTileCache] = useState<Map<string, string[]>>(new Map());
  // 룰타일 전용: sheetId → 순수 베이스 지형 타일 변형 목록 (그리드 슬롯 밖의 별도 타일)
  const [baseTileCache, setBaseTileCache] = useState<Map<string, string[]>>(new Map());
  /**
   * 룰타일 전용: sheetId → 머티리얼 시트 dataURL (메모리 캐시).
   *
   * 경계선 프리셋/아웃라인을 바꿀 때마다 imageStorage를 다시 읽지 않도록 원본을 들고 있는다.
   * 이게 있어야 설정 변경이 **체감상 즉시** 반영된다(IndexedDB 왕복 제거).
   */
  const materialSheetsRef = useRef<Map<string, string>>(new Map());
  /** 경계 설정 변경으로 재합성 중인지 (결과 뷰 표시용) */
  const [isRecomposing, setIsRecomposing] = useState(false);

  const grid: TilemapGridLayout = isTilemapGridLayout(pixelArtGrid) ? pixelArtGrid : '4x4';

  // 보유 타일의 실제 그리드 — 뷰·내보내기는 이 값을 쓴다 (다음 생성 목표 grid와 분리, 스펙 §8)
  const displayGrid: TilemapGridLayout =
    tilemapData && tilemapData.slotAssignments.length > 0 ? tilemapData.grid : grid;

  // 보유 세트의 모드 — displayGrid와 같은 원리로 보유 데이터 우선, 없으면 'variation' 폴백
  const effectiveMode: TilemapMode = tilemapData?.mode ?? 'variation';

  /**
   * 보유 세트의 투명 지형 여부. **패널의 입력 필드가 아니라 저장된 플래그**를 본다 —
   * 입력 필드는 "다음 생성 목표"라서, 사용자가 지형 텍스트를 지운 순간 보유 세트가
   * 투명으로 재해석되면 안 된다(경계 설정을 만질 때마다 결과가 달라진다).
   * v5 이전 세션에는 플래그가 없고 그때는 두 지형이 모두 필수였으므로 false다.
   */
  const storedTransparentBase = tilemapData?.transparentBase ?? false;
  const storedTransparentOverlay = tilemapData?.transparentOverlay ?? false;

  // 세션 전환 감지를 위한 시트 정체성 (길이만으로는 다른 세션의 동일 개수 시트를 구분 못함)
  const sheetIds = tilemapData?.sheets.map((s) => s.id).join(',') ?? '';

  // 아웃라인은 객체라 매 렌더 새 참조일 수 있으므로 내용 기반 키로 의존성을 건다
  const outlineKey = makeOutlineKey(outlineSide, outline, outline2);

  /** 보유 세트가 현재 합성 알고리즘 결과인지 (레거시 분기·재생성 안내에 함께 쓴다) */
  const isCurrentComposer = isCurrentComposerVersion(tilemapData);

  // 세션 재진입 시: 저장된 시트를 로드해 캐시 복원
  useEffect(() => {
    if (!enabled || !tilemapData || tilemapData.sheets.length === 0) return;
    let cancelled = false;

    // 보유 데이터의 모드·버전을 따른다 (패널의 "다음 생성 목표"가 아니다)
    const restoreMode: TilemapMode = tilemapData.mode ?? 'variation';
    /**
     * 레거시 변형 세트(v1)는 시트가 **타일 시트**다 — 스와치로 해석하면 결과가 완전히
     * 달라지므로 그때만 분할 경로를 유지한다.
     *
     * 룰타일은 버전으로 분기하지 않는다. 예전 룰타일 세션도 지금까지 `buildRuleTileSet`으로
     * 복원해 왔고, 그 동작을 바꾸면 이번 변경과 무관한 기존 세션의 화면이 달라진다
     * (`needsRecompose` 배너로 재생성을 안내하는 것까지가 이 변경의 범위다).
     */
    const legacyVariation = restoreMode === 'variation' && !isCurrentComposerVersion(tilemapData);
    const referenced = referencedSheetIds(tilemapData);

    (async () => {
      const restored = new Map<string, string[]>();
      const restoredBase = new Map<string, string[]>();
      for (const sheet of tilemapData.sheets) {
        if (!isSheetReferenced(referenced, sheet.id)) continue;
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
              outline2: tilemapData.outline2,
              outlineSide: tilemapData.outlineSide,
              transparentBase: tilemapData.transparentBase,
              transparentOverlay: tilemapData.transparentOverlay,
            });
            restored.set(sheet.id, set.tiles);
            restoredBase.set(sheet.id, set.baseTiles);
          } else if (legacyVariation) {
            restored.set(sheet.id, await sliceTileSheet(dataUrl, tilemapData.grid));
          } else {
            const set = await buildVariationTileSet(dataUrl, tilemapData.grid);
            restored.set(sheet.id, set.tiles);
            warnIfNoVariation(set.distinctCount, set.slotCount);
          }
        } catch (e) {
          logger.error('❌ 타일 시트 복원 실패:', sheet.id, e);
        }
      }
      // 세션 전환 시 이전 세션의 캐시가 남아있으면 안 되므로 병합이 아닌 교체
      if (!cancelled) {
        setTileCache(restored);
        setBaseTileCache(restoredBase);
      }
    })();

    return () => { cancelled = true; };
    /*
      시트 정체성(sheetIds)·그리드·모드·합성 버전 변화 시에만 재실행
      (신규 시트는 processNewSheet가 즉시 캐시한다).

      경계 설정 변경은 아래 전용 이펙트가 처리한다 — "저장소에서 복원"과 "설정으로 재합성"은
      다른 관심사이고, 한 이펙트에 섞으면 비동기 경합과 의존성 추적이 얽힌다.

      **`slotAssignments`는 읽지만 의존성에 없다.** 지금 그게 안전한 건 슬롯을 바꾸는
      경로(`reshuffleSlots`·`toggleLock`)가 **참조하는 sheetId 집합을 바꾸지 않기** 때문이다
      (같은 시트 안에서 cellIndex/locked만 바꾼다). 슬롯이 다른 시트를 가리킬 수 있게 되면
      `referenced`가 낡아 캐시가 비므로, 그때는 여기에 의존성을 추가해야 한다.
    */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, sheetIds, tilemapData?.grid, tilemapData?.mode, tilemapData?.composerVersion]);

  /**
   * 경계선 프리셋·아웃라인이 바뀌면 **캐시된 머티리얼 시트로 즉시 재합성**한다.
   * 생성 API를 다시 부르지 않는다 — 합성은 로컬 연산(세트 전체 약 0.5초)이다.
   */
  useEffect(() => {
    if (!enabled || !tilemapData) return;
    if ((tilemapData.mode ?? 'variation') !== 'ruletile') return;
    if (tilemapData.sheets.length === 0) return;
    // 저장된 설정과 같으면 복원 이펙트 결과가 이미 맞다 — 중복 합성 방지
    const storedKey = makeOutlineKey(
      tilemapData.outlineSide,
      tilemapData.outline,
      tilemapData.outline2
    );
    if (tilemapData.edgeStyle === edgeStyle && storedKey === outlineKey) return;

    let cancelled = false;
    // 컬러 피커는 드래그 중 연속으로 값을 쏘므로 살짝 디바운스한다
    const timer = setTimeout(() => {
      (async () => {
        setIsRecomposing(true);
        try {
          const nextTiles = new Map<string, string[]>();
          const nextBase = new Map<string, string[]>();
          // 복원 이펙트와 **같은 기준**으로 걸러야 한다 (referencedSheetIds 주석 참조).
          // 아웃라인은 컬러 피커 드래그로 연속 호출되는 가장 뜨거운 경로다
          const referenced = referencedSheetIds(tilemapData);
          for (const sheet of tilemapData.sheets) {
            if (!isSheetReferenced(referenced, sheet.id)) continue;
            const dataUrl =
              materialSheetsRef.current.get(sheet.id) ?? (await loadImage(sheet.imageKey));
            if (!dataUrl) continue;
            materialSheetsRef.current.set(sheet.id, dataUrl);
            const set = await buildRuleTileSet(dataUrl, tilemapData.grid, {
              edgeStyle,
              outline,
              outline2,
              outlineSide,
              transparentBase: tilemapData.transparentBase,
              transparentOverlay: tilemapData.transparentOverlay,
            });
            nextTiles.set(sheet.id, set.tiles);
            nextBase.set(sheet.id, set.baseTiles);
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
    const storedKey = makeOutlineKey(
      tilemapData.outlineSide,
      tilemapData.outline,
      tilemapData.outline2
    );
    if (tilemapData.edgeStyle === edgeStyle && storedKey === outlineKey) return;
    onTilemapDataChange({ ...tilemapData, edgeStyle, outline, outline2, outlineSide });
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

  /**
   * 생성 완료된 시트를 후처리 (저장→합성→슬롯 전체 할당).
   *
   * @returns 자동 내보내기용 payload. 두 모드 모두 항상 슬롯 전체가 확정되므로 null이 아니다
   *   (상태 반영은 비동기라 호출부가 `currentTiles`를 바로 읽을 수 없어 확정 타일을 직접 돌려준다).
   */
  const processNewSheet = useCallback(async (
    sheetDataUrl: string
  ): Promise<{ tiles: string[]; baseTiles: string[]; grid: TilemapGridLayout; mode: TilemapMode } | null> => {
    if (!enabled || !onTilemapDataChange) return null;

    const isRuletile = mode === 'ruletile';
    // 두 모드 모두 시트를 자르지 않고 재질 스와치로 해석해 타일을 절차적으로 합성한다.
    // 룰타일은 지형 입력이 비어 있으면 그 지형을 재질 대신 투명으로 합성한다
    const transparentBase = isRuletile && !baseTerrain?.trim();
    const transparentOverlay = isRuletile && !overlayTerrain?.trim();

    /**
     * `pool`은 `cellIndex`가 가리키는 배열이고, 슬롯은 그중 앞 `slotCount`장을 쓴다.
     * 룰타일은 슬롯마다 역할이 고정이라 풀 == 슬롯이지만, 변형은 슬롯 교체용 여유분이
     * 있어 풀이 더 크다(`VARIATION_POOL_MULTIPLIER`).
     */
    let pool: string[];
    let slotCount: number;
    let baseTiles: string[] = [];
    if (isRuletile) {
      const set = await buildRuleTileSet(sheetDataUrl, grid, {
        edgeStyle,
        outline,
        outline2,
        outlineSide,
        transparentBase,
        transparentOverlay,
      });
      pool = set.tiles;
      slotCount = set.tiles.length;
      baseTiles = set.baseTiles;
    } else {
      const set = await buildVariationTileSet(sheetDataUrl, grid);
      pool = set.tiles;
      slotCount = set.slotCount;
      warnIfNoVariation(set.distinctCount, set.slotCount);
    }
    // 내보내기·미리보기는 **배정된 타일만** 본다 (여유분은 화면에도 파일에도 나가지 않는다)
    const assignedTiles = pool.slice(0, slotCount);

    const sheetId = `sheet-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    const imageKey = `tilemap-sheet-${sheetId}`;
    await saveImageWithKey(imageKey, sheetDataUrl);
    const sheet: TilemapSheet = { id: sheetId, imageKey, createdAt: new Date().toISOString() };

    setTileCache((prev) => new Map(prev).set(sheetId, pool));
    if (baseTiles.length > 0) setBaseTileCache((prev) => new Map(prev).set(sheetId, baseTiles));
    // 경계 설정 변경 시 imageStorage를 다시 읽지 않도록 머티리얼 시트를 메모리에 캐시
    if (isRuletile) materialSheetsRef.current.set(sheetId, sheetDataUrl);

    const prevData = tilemapData;

    /*
      새 시트가 슬롯 **전체**를 채우고, 시트 목록도 이 한 장으로 갈아치운다.

      슬롯마다 다른 시트를 섞는 것은 이제 불가능하다 — 시트가 곧 재질 스와치이고, 서로
      다른 스와치에서 나온 타일은 정규 텍스처가 달라 변 픽셀이 일치하지 않는다. 즉
      혼합은 접합 계약을 깨뜨린다. 같은 스와치 안에서의 재배치는 `reshuffleSlots`가 한다.

      예전에는 교체 제안(`proposal`)이 여러 시트에 걸친 슬롯 배정을 만들 수 있어 과거
      시트를 배열에 남겨 뒀다. 그 흐름이 없어진 지금 남은 시트는 **읽는 곳이 전혀 없는**
      1024px 이미지일 뿐이라, 생성할 때마다 imageStorage가 영구히 불어난다. 그래서 목록을
      새 시트 하나로 줄이고 밀려난 이미지는 지운다(생성물 자체는 히스토리와 자동
      내보내기 폴더에 각각 남으므로 잃는 것이 없다).
    */
    const displaced = prevData?.sheets.filter((s) => s.id !== sheetId) ?? [];
    onTilemapDataChange({
      grid,
      mode,
      baseTerrain: mode === 'ruletile' ? baseTerrain : undefined,
      overlayTerrain: mode === 'ruletile' ? overlayTerrain : undefined,
      composerVersion: isRuletile ? COMPOSER_VERSION : VARIATION_COMPOSER_VERSION,
      edgeStyle: isRuletile ? edgeStyle : undefined,
      outline: isRuletile ? outline : undefined,
      outline2: isRuletile ? outline2 : undefined,
      outlineSide: isRuletile ? outlineSide : undefined,
      transparentBase: isRuletile ? transparentBase : undefined,
      transparentOverlay: isRuletile ? transparentOverlay : undefined,
      sheets: [sheet],
      slotAssignments: assignedTiles.map((_, i) => ({ slotIndex: i, sheetId, cellIndex: i })),
    });

    // 정리 실패가 생성 결과를 잃게 하면 안 되므로 기다리지 않고 로그만 남긴다
    for (const old of displaced) {
      deleteImage(old.imageKey).catch((e) =>
        logger.warn('⚠️ 이전 타일맵 시트 정리 실패(무시):', old.imageKey, e)
      );
    }
    return { tiles: assignedTiles, baseTiles, grid, mode };
  }, [enabled, onTilemapDataChange, grid, tilemapData, mode, baseTerrain, overlayTerrain, edgeStyle, outline, outline2, outlineSide]);

  /**
   * 선택 슬롯을 **같은 스와치의 다른 변형**으로 다시 뽑는다 (변형 모드 전용).
   *
   * 생성 API를 부르지 않는다 — 변형은 이미 전부 만들어져 캐시에 있고, 슬롯은 그중
   * 어느 것을 가리킬지의 문제일 뿐이다. 모든 변형이 변 픽셀을 공유하므로 어떤 조합으로
   * 바꿔도 접합은 그대로다.
   *
   * ## 왜 풀이 슬롯보다 커야 하는가
   * 처음 구현은 "아직 안 쓰인 변형을 우선 배정"만 했는데, 풀 크기가 슬롯 수와 같으면
   * `used`가 비대상 슬롯의 셀 전부를 차지해 **남는 것이 선택 슬롯 자신의 셀뿐**이 된다.
   * 그래서 슬롯 1개를 고르면 자기 셀을 그대로 다시 받아 100% 아무 일도 일어나지 않았고
   * (2개면 50%), 내보내는 세트도 순서만 다른 같은 타일들이었다. 해결은 풀에 여유분을 두는
   * `VARIATION_POOL_MULTIPLIER`다 — 그 덕에 몇 개를 고르든 **아직 안 쓴 변형**이 남아 있다.
   *
   * 아래 폴백(현재와 다른 아무 변형, 중복 허용)은 풀이 슬롯 수보다 크지 않은 경우를 위한
   * 안전망이다. 지금 그런 세트는 레거시 v1(분할 결과라 풀 == 슬롯)뿐이고 UI가 버튼을
   * 막으므로 평소에는 타지 않지만, 배수를 1로 바꾸면 이 경로가 유일한 동작이 된다.
   *
   * 락 슬롯은 대상에서 제외한다.
   */
  const reshuffleSlots = useCallback((slotIndexes: number[]) => {
    if (effectiveMode === 'ruletile') return;
    if (!tilemapData || !onTilemapDataChange) return;
    const assignments = tilemapData.slotAssignments;
    if (assignments.length === 0) return;

    /*
      레거시 세트(v1)는 예전 교체 제안 흐름 때문에 슬롯이 **여러 시트**에 걸쳐 있을 수
      있다. 그런 세트의 타일은 서로 변 픽셀을 공유하지 않으므로 재배치해 봐야 의미가
      없고, 시트 하나를 골라 풀로 삼으면 다른 시트의 셀을 잘못 가리킬 수 있다.
      UI에서도 버튼을 막지만 여기서 이중으로 방어한다.
    */
    const sheetIdSet = new Set(assignments.map((a) => a.sheetId));
    if (sheetIdSet.size !== 1) return;
    const poolSize = tileCache.get(assignments[0].sheetId)?.length ?? 0;
    if (poolSize <= 1) return;

    // 슬롯은 `slotIndex`로 찾는다 — 배열 순서와 같다고 가정하면 락 슬롯을 잘못 건드릴 수 있다
    const bySlot = new Map(assignments.map((a) => [a.slotIndex, a]));
    const targets = new Set(
      slotIndexes.filter((i) => {
        const a = bySlot.get(i);
        return !!a && !a.locked;
      })
    );
    if (targets.size === 0) return;

    // 교체 대상이 아닌 슬롯이 이미 쓰고 있는 변형은 남겨 둔다
    const used = new Set(
      assignments.filter((a) => !targets.has(a.slotIndex)).map((a) => a.cellIndex)
    );
    const free: number[] = [];
    for (let i = 0; i < poolSize; i++) if (!used.has(i)) free.push(i);
    // 고르게 섞어 배정한다 (Fisher-Yates)
    for (let i = free.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [free[i], free[j]] = [free[j], free[i]];
    }

    /*
      자기 셀을 그대로 다시 받는 배정은 "안 바뀌었다"로 보이므로 건너뛴다.
      여유분이 있어도 셔플 결과 우연히 자기 셀이 걸릴 수 있어서, 배정 전에 확인한다.
    */
    let cursor = 0;
    const pickFree = (current: number): number | null => {
      for (let k = cursor; k < free.length; k++) {
        if (free[k] === current) continue;
        [free[cursor], free[k]] = [free[k], free[cursor]];
        return free[cursor++];
      }
      return null;
    };

    onTilemapDataChange({
      ...tilemapData,
      slotAssignments: assignments.map((a) => {
        if (!targets.has(a.slotIndex)) return a;
        const fromFree = pickFree(a.cellIndex);
        if (fromFree !== null) return { ...a, cellIndex: fromFree };
        // 남는 변형이 없다 — 현재와 다른 아무 변형이나 고른다 (중복은 허용)
        let next = Math.floor(Math.random() * poolSize);
        if (next === a.cellIndex) next = (next + 1) % poolSize;
        return { ...a, cellIndex: next };
      }),
    });
  }, [effectiveMode, tilemapData, onTilemapDataChange, tileCache]);

  /** 슬롯 락 토글 (변형 재배치에서 보호, 룰타일은 역할 고정이라 no-op) */
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
   * (`tilesheet.png`)과 다르게 보인다(두 모드 모두 원본이 재질 스와치라 완전히 다름).
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

  /** 보유 룰타일 세트에서 베이스 지형이 투명인지 (미리보기·내보내기 안내에 쓴다) */
  const baseTransparent = enabled && effectiveMode === 'ruletile' && storedTransparentBase;
  /** 보유 룰타일 세트에서 오버레이 지형이 투명인지 */
  const overlayTransparent = enabled && effectiveMode === 'ruletile' && storedTransparentOverlay;

  /** 룰타일 순수 베이스 지형 타일 변형 목록 — 그리드 슬롯 밖의 별도 타일 (베이스가 투명이면 빈 배열) */
  const baseTiles: string[] = (() => {
    if (!enabled || effectiveMode !== 'ruletile' || !tilemapData) return [];
    const lastSheet = tilemapData.sheets[tilemapData.sheets.length - 1];
    return lastSheet ? baseTileCache.get(lastSheet.id) ?? [] : [];
  })();

  /**
   * 보유한 세트가 현재 합성 알고리즘보다 오래됐는지.
   *
   * 두 모드 모두 해당한다. 특히 **변형 v1(시트를 잘라 만든 세트)** 은 접합 보장이 없어
   * 임의 배치에서 이음새가 어긋난다 — 사용자가 그 사실을 알 방법이 없으므로 결과 뷰에서
   * 재생성을 안내해야 한다. 레거시 세트도 그대로 보이고 내보내기까지 되지만, 보장은 없다.
   */
  const needsRecompose =
    enabled &&
    !!tilemapData &&
    tilemapData.slotAssignments.length > 0 &&
    !isCurrentComposer;

  return {
    grid,
    displayGrid,
    effectiveMode,
    currentTiles,
    baseTiles,
    baseTransparent,
    overlayTransparent,
    composedSheet,
    isRecomposing,
    needsRecompose,
    processNewSheet,
    reshuffleSlots,
    toggleLock,
  };
}
