/**
 * 변형 세트 합성기 — 재질 스와치 1장에서 임의 배치 가능한 타일 변형들을 만든다.
 *
 * ## 왜 자르지 않는가
 * v1은 AI에게 "N장이 그리드로 배치된 타일 시트"를 받아 `sliceTileSheet`로 잘랐다.
 * 그 방식은 임의 배치에서 이음새가 어긋난다 — **엣지 계약이 없기 때문**이다:
 *
 * - 잘라낸 타일은 시트에서 **원래 붙어 있던 이웃**과만 이어진다. 랜덤 배치는 원래
 *   이웃이 아닌 조합을 만들므로 경계가 맞을 이유가 없다.
 * - 임의 배치가 성립하려면 (a) 모든 타일의 좌변 픽셀 = 우변 픽셀, 상변 = 하변이고
 *   (b) 각 타일이 wrap 연속이어야 한다. 이건 **픽셀 단위 계약**이라 프롬프트로
 *   요청할 수 있는 종류의 것이 아니다. 실제로 v1의 "외곽 15%를 조용하게" 규칙은
 *   완화 요청일 뿐이라 픽셀 일치를 만들지 못했다.
 * - 당시의 seam 점수는 4px 스트립을 변당 32지점으로 **평균**한 RGB 비교라
 *   고주파 불일치가 묻혔다. 눈에 보이는 이음새가 90점으로 통과하는 일이 잦아,
 *   문제를 드러내기는커녕 가려 줬다.
 *
 * ## v2 계약
 * 룰타일 v3와 같은 방식으로 바꾼다. AI에게는 **재질과 화풍만** 받고(재질 스와치),
 * 타일은 코드가 만든다:
 *
 * 1. 스와치 중앙을 1:1 크롭해 `makeSeamless`로 **wrap 연속 정규 텍스처**를 만든다
 *    → 조건 (b). 같은 타일이 반복돼도 이음새가 없다.
 * 2. 변형은 정규 텍스처의 **안쪽에만** 스와치의 다른 위치 크롭을 얹는다
 *    (`buildTextureVariants`의 엣지 계약) → 조건 (a). 모든 변형의 변 픽셀이 정규
 *    텍스처와 동일하므로, 어떤 두 변형이 이웃해도 접합부가 이어진다.
 *
 * 두 조건이 모두 **구성으로 보장**되므로 배치 순서와 무관하다. 룰타일과 달리 지형
 * 경계가 없어 마스크·아웃라인 단계가 통째로 빠지고, 1~2단계만 쓴다.
 *
 * 계약 검증은 `tilemapSelfCheck.checkVariationSet`(dev 전용 게이트)이 전수로 한다.
 */

import { getPixelArtGridInfo } from '../../types/pixelart';
import { TilemapGridLayout } from '../../types/tilemap';
import { buildTextureVariants, textureToDataUrl } from './seamlessTexture';
import { loadImageElement } from './tileSlicer';

/**
 * 변형 세트 합성 알고리즘 버전 (`TilemapSessionData.composerVersion`에 기록).
 *
 * 타일을 저장하지 않고 스와치에서 매번 재구성하므로, 알고리즘이 바뀌면 기존 세션의
 * 결과도 달라진다. **값이 없으면 v1(시트를 잘라 만든 세트)** 이고, 그 세션의 시트는
 * 스와치가 아니라 타일 시트라서 이 합성기에 넣으면 안 된다 — 복원 경로가 버전으로
 * 분기해 v1은 계속 `sliceTileSheet`로 읽는다.
 *
 * v1(암묵): AI 타일 시트를 그리드로 분할. 엣지 계약 없음.
 * v2: 재질 스와치에서 절차적으로 합성. 엣지 계약으로 임의 배치 접합 보장.
 */
export const VARIATION_COMPOSER_VERSION = 2;

/**
 * 변형 **풀** 크기 = 슬롯 수 x 이 배수.
 *
 * 슬롯 수만큼만 만들면 슬롯 교체가 무의미해진다: 풀과 슬롯이 1:1 대응이라 교체는
 * 이미 화면에 있는 변형끼리 자리를 바꾸는 것밖에 못 하고(슬롯 1개만 고르면 바꿀 상대가
 * 자기뿐이라 **아무 일도 일어나지 않는다**), 내보내는 세트는 순서만 다른 같은 64장이라
 * 결과물이 전혀 달라지지 않는다.
 *
 * 여유분을 두면 "이 타일 마음에 안 든다"는 요청에 **아직 안 쓴 변형**을 줄 수 있고,
 * 그때 내보내는 세트도 실제로 바뀐다. 변형은 전부 같은 정규 텍스처에서 나오므로
 * 여유분이 늘어도 접합 계약은 그대로다.
 */
const VARIATION_POOL_MULTIPLIER = 2;

/** 변형 세트 합성 결과 */
export interface VariationTileSet {
  /**
   * 변형 **풀** dataURL — `slotCount x VARIATION_POOL_MULTIPLIER`장.
   * 슬롯의 `cellIndex`가 이 배열을 가리킨다. 앞 `slotCount`장이 초기 배정분이고
   * 나머지는 슬롯 교체용 여유분이다(내보내기에는 배정된 것만 나간다).
   */
  tiles: string[];
  /** 초기 슬롯 배정 개수 (= 그리드의 타일 수) */
  slotCount: number;
  /**
   * 서로 다른 변형이 실제로 몇 장 만들어졌는지.
   *
   * 스와치가 타일보다 작으면(모델이 규격 미만 이미지를 준 경우) 변형을 만들 수 없어
   * 1이 된다 — 그때는 풀이 정규 텍스처의 복사본으로 채워진다. 이음새는 여전히 없지만
   * (wrap 연속이므로) 무늬 반복이 그대로 남으므로 호출부가 알아야 한다.
   */
  distinctCount: number;
}

/**
 * 재질 스와치에서 변형 타일 풀을 합성한다.
 *
 * @param swatchDataUrl AI가 생성한 재질 스와치 (캔버스 전체가 하나의 균질한 재질 필드)
 * @param grid          '4x4'(슬롯 16·셀 256px) 또는 '8x8'(슬롯 64·셀 128px)
 */
export async function buildVariationTileSet(
  swatchDataUrl: string,
  grid: TilemapGridLayout
): Promise<VariationTileSet> {
  const { cellSize, totalFrames } = getPixelArtGridInfo(grid);
  const img = await loadImageElement(swatchDataUrl);
  const poolSize = totalFrames * VARIATION_POOL_MULTIPLIER;

  // 캔버스 전체가 스와치다 — 룰타일처럼 좌/우로 나누지 않는다.
  // index 0이 정규 텍스처, 나머지가 변 픽셀을 공유하는 변형들이다
  const textures = buildTextureVariants(img, 0, 0, img.width, img.height, cellSize, poolSize);

  // 변형을 못 만든 경우엔 정규 텍스처로 풀을 채운다 — 슬롯을 비워 두면
  // 미리보기·내보내기가 막히기 때문이다 (distinctCount로 호출부에 알린다)
  const tiles: string[] = [];
  for (let i = 0; i < poolSize; i++) {
    tiles.push(textureToDataUrl(textures[i % textures.length], cellSize));
  }

  return { tiles, slotCount: totalFrames, distinctCount: textures.length };
}
