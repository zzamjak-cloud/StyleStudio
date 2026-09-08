/**
 * 정규 텍스처 안쪽에 다른 크롭을 **이식(graft)** 하는 유틸.
 *
 * ## 왜 알파 크로스페이드를 버렸는가
 * v2까지 변형은 `variant = (1-a)*canonical + a*crop` 이었다. `a`는 변에서 0, 안쪽에서 1로
 * 가는 스무스스텝이라 변 픽셀 계약은 지켜졌지만, 그 사이 램프 구간이 **두 텍스처의 평균**
 * 이었다. 결과는 타일마다 흐릿한 사각 액자가 생기고(정규 링 ↔ 크롭 내부), 암반 층리처럼
 * 방향성 있는 무늬는 링에 닿는 순간 끊긴다. 세트를 깔면 그 액자가 셀마다 반복돼 격자로
 * 읽힌다 — 경계 렌더링에서 이미 폐기한 "밴드 알파 블렌딩"과 같은 오류다.
 *
 * 램프를 넓히든 좁히든 이 문제는 못 고친다. 평균은 원리적으로 탁하고, 무늬가 어긋난
 * 자리를 부드럽게 만들 뿐 **맞물리게** 하지는 못하기 때문이다.
 *
 * ## v3: 최소오차 컷 + 그래디언트 도메인 이식
 * 텍스처 합성의 정석 2단을 쓴다.
 *
 * 1. **최소오차 컷** (Efros & Freeman, image quilting). 변에서 `BAND` 픽셀까지의 띠 안에서,
 *    정규와 크롭이 **이미 비슷한 픽셀들을 따라가는 경로**를 4변 각각 DP로 찾는다. 그 경로
 *    바깥은 100% 정규, 안쪽은 100% 크롭 — 섞지 않는다. 무늬가 어긋난 자리를 피해서
 *    갈아타므로 층리선이 잘려 보이지 않는다.
 * 2. **그래디언트 도메인 이식** (Poisson seamless cloning). 컷을 아무리 잘 골라도 두 크롭의
 *    전체 밝기·색조는 다르다. 그래서 크롭의 **기울기만** 가져오고 컷 위의 값은 정규에 맞춘다:
 *    조화 함수(막) `u`를 컷 경계값 `canonical - crop`으로 풀어 `crop + u`를 쓴다. 저주파
 *    차이만 전역에 퍼지므로 디테일은 하나도 흐려지지 않고 이음매만 사라진다.
 *
 * ## 엣지 계약과의 관계
 * 컷 깊이의 하한이 `EDGE_HOLD_PX`이므로 변에서 그 픽셀까지는 **항상 마스크 바깥** = 정규
 * 텍스처를 그대로 복사한다. 막 `u`는 마스크 안쪽에만 더해지므로 변 픽셀은 정규와 **비트
 * 단위로 동일**하다(v2는 램프 계산의 반올림 때문에 허용오차가 필요했다). 계약이 알파 계산의
 * 성질이 아니라 마스크의 성질이 되어 더 강해졌다.
 *
 * ## 막을 푸는 방법
 * 컷이 오차 최소 경로를 타므로 경계값 `canonical - crop`은 애초에 작다. 즉 막의 진폭이 작아
 * 엄밀한 조화성은 눈에 영향이 없다. 그래서 다중격자 대신 **pull-push 피라미드**(가중
 * 다운샘플 → 업샘플 채우기)로 초기값을 만들고 최종 해상도에서 가우스-자이델을 몇 번만
 * 돌린다 — O(N)이고 변형 128장을 합성해도 체감되지 않는다.
 */

/** 컷이 놓일 수 있는 최대 인셋 (타일 한 변 대비). 이 띠 안에서만 갈아탄다. */
const BAND_RATIO = 0.22;
/** 변에서 이 픽셀까지는 무조건 정규 텍스처 — 엣지 계약의 하한(컷 깊이 최소값) */
export const EDGE_HOLD_PX = 2;
/** 컷 경로가 인접 위치 사이에서 바뀔 수 있는 깊이 (1이면 8-연결 경로) */
const CUT_SLOPE = 1;
/** 막을 다듬는 가우스-자이델 스윕 횟수 (pull-push 초기값 위에서) */
const RELAX_SWEEPS = 8;

/** 띠 폭을 타일 크기에서 구한다 (컷 깊이 범위는 [EDGE_HOLD_PX, band-1]) */
function bandWidth(T: number): number {
  return Math.max(EDGE_HOLD_PX + 2, Math.round(T * BAND_RATIO));
}

/** 두 버퍼의 한 픽셀 RGB 절대차 합 (0~765) */
function pixelError(a: Uint8ClampedArray, b: Uint8ClampedArray, i: number): number {
  return Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
}

/**
 * 크롭 후보가 정규 텍스처의 **테두리 띠와 얼마나 맞는지** 잰다 (낮을수록 좋다).
 *
 * 컷은 이 띠 안에서만 그어지므로, 띠가 애초에 잘 맞는 크롭을 고르면 컷이 지날 수 있는
 * 저오차 경로가 많아진다. 이 선택 단계가 없으면 DP가 "덜 나쁜 자리"밖에 못 찾는다.
 */
export function bandMismatch(
  canonical: Uint8ClampedArray,
  crop: Uint8ClampedArray,
  T: number
): number {
  const band = bandWidth(T);
  let sum = 0;
  let n = 0;
  for (let y = 0; y < T; y++) {
    const dy = Math.min(y, T - 1 - y);
    for (let x = 0; x < T; x++) {
      const d = Math.min(dy, Math.min(x, T - 1 - x));
      if (d >= band) continue;
      sum += pixelError(canonical, crop, (y * T + x) * 4);
      n++;
    }
  }
  return n === 0 ? 0 : sum / n;
}

/**
 * 한 변의 최소오차 컷 깊이를 DP로 구한다.
 *
 * 상태 (s, d) = "변을 따라 s 위치에서 깊이 d의 픽셀을 지나는 경로". 비용은 그 픽셀의
 * 정규↔크롭 오차이고, 이웃 위치로는 깊이가 `CUT_SLOPE` 이내로만 바뀔 수 있다(경로가
 * 끊기지 않도록). 전형적인 image quilting의 최소오차 경계 컷이다.
 *
 * @param len   변을 따르는 길이
 * @param minD  최소 깊이 (엣지 계약 하한)
 * @param maxD  최대 깊이 (띠 폭 - 1)
 * @param errAt (s, d) → 그 픽셀의 오차
 * @returns     위치별 컷 깊이. 이 깊이의 픽셀까지가 정규, 그 다음부터 크롭이다.
 */
function solveCutDepths(
  len: number,
  minD: number,
  maxD: number,
  errAt: (s: number, d: number) => number
): Int32Array {
  const span = maxD - minD + 1;
  const cost = new Float64Array(len * span);
  const from = new Int32Array(len * span);

  for (let d = 0; d < span; d++) cost[d] = errAt(0, minD + d);

  for (let s = 1; s < len; s++) {
    const base = s * span;
    const prev = base - span;
    for (let d = 0; d < span; d++) {
      let best = Infinity;
      let bestK = d;
      const lo = Math.max(0, d - CUT_SLOPE);
      const hi = Math.min(span - 1, d + CUT_SLOPE);
      for (let k = lo; k <= hi; k++) {
        const c = cost[prev + k];
        if (c < best) {
          best = c;
          bestK = k;
        }
      }
      cost[base + d] = best + errAt(s, minD + d);
      from[base + d] = bestK;
    }
  }

  // 마지막 위치에서 최소 비용 상태를 찾아 역추적
  const depths = new Int32Array(len);
  let bestD = 0;
  let best = Infinity;
  const last = (len - 1) * span;
  for (let d = 0; d < span; d++) {
    if (cost[last + d] < best) {
      best = cost[last + d];
      bestD = d;
    }
  }
  for (let s = len - 1; s >= 0; s--) {
    depths[s] = minD + bestD;
    bestD = from[s * span + bestD];
  }
  return depths;
}

/**
 * 고정 픽셀의 값을 미고정 영역으로 부드럽게 확산시킨다 (pull-push 피라미드 + 완화).
 *
 * 조화 확장(라플라스 방정식의 디리클레 해)의 근사다. 피라미드로 전역 형태를 잡고 최종
 * 해상도에서 가우스-자이델로 국소를 다듬는다. 고정 픽셀 값은 절대 바뀌지 않는다.
 *
 * @param T     한 변
 * @param fixed 1이면 값이 고정된 픽셀
 * @param field 3채널 값. 고정 픽셀에는 경계값이 들어 있어야 하고, 나머지가 채워진다.
 */
function diffuseMembrane(T: number, fixed: Uint8Array, field: Float32Array): void {
  // --- pull: 가중 평균으로 피라미드를 쌓는다 ---
  const sizes: number[] = [];
  const values: Float32Array[] = [];
  const weights: Float32Array[] = [];

  let size = T;
  let value = field;
  let weight = new Float32Array(T * T);
  for (let i = 0; i < T * T; i++) weight[i] = fixed[i] ? 1 : 0;
  sizes.push(size);
  values.push(value);
  weights.push(weight);

  while (size > 2) {
    const half = Math.ceil(size / 2);
    const cv = new Float32Array(half * half * 3);
    const cw = new Float32Array(half * half);
    for (let y = 0; y < half; y++) {
      for (let x = 0; x < half; x++) {
        let wsum = 0;
        let r = 0;
        let g = 0;
        let b = 0;
        for (let dy = 0; dy < 2; dy++) {
          const sy = y * 2 + dy;
          if (sy >= size) continue;
          for (let dx = 0; dx < 2; dx++) {
            const sx = x * 2 + dx;
            if (sx >= size) continue;
            const si = sy * size + sx;
            const w = weight[si];
            if (w <= 0) continue;
            wsum += w;
            r += value[si * 3] * w;
            g += value[si * 3 + 1] * w;
            b += value[si * 3 + 2] * w;
          }
        }
        const ci = y * half + x;
        if (wsum > 0) {
          cv[ci * 3] = r / wsum;
          cv[ci * 3 + 1] = g / wsum;
          cv[ci * 3 + 2] = b / wsum;
        }
        cw[ci] = Math.min(1, wsum / 4);
      }
    }
    sizes.push(half);
    values.push(cv);
    weights.push(cw);
    size = half;
    value = cv;
    weight = cw;
  }

  // --- push: 위 레벨의 값을 아래 레벨의 빈 픽셀에 채운다 (쌍선형) ---
  for (let l = sizes.length - 2; l >= 0; l--) {
    const fs = sizes[l];
    const cs = sizes[l + 1];
    const fv = values[l];
    const fw = weights[l];
    const cv = values[l + 1];
    for (let y = 0; y < fs; y++) {
      // 부모 격자 좌표 (셀 중심 정렬)
      const gy = Math.min(cs - 1, Math.max(0, (y - 0.5) * 0.5));
      const y0 = Math.floor(gy);
      const y1 = Math.min(cs - 1, y0 + 1);
      const ty = gy - y0;
      for (let x = 0; x < fs; x++) {
        const fi = y * fs + x;
        const w = fw[fi];
        if (w >= 1) continue;
        const gx = Math.min(cs - 1, Math.max(0, (x - 0.5) * 0.5));
        const x0 = Math.floor(gx);
        const x1 = Math.min(cs - 1, x0 + 1);
        const tx = gx - x0;
        for (let ch = 0; ch < 3; ch++) {
          const v00 = cv[(y0 * cs + x0) * 3 + ch];
          const v10 = cv[(y0 * cs + x1) * 3 + ch];
          const v01 = cv[(y1 * cs + x0) * 3 + ch];
          const v11 = cv[(y1 * cs + x1) * 3 + ch];
          const top = v00 + (v10 - v00) * tx;
          const bottom = v01 + (v11 - v01) * tx;
          const up = top + (bottom - top) * ty;
          fv[fi * 3 + ch] = fv[fi * 3 + ch] * w + up * (1 - w);
        }
      }
    }
  }

  // --- 완화: 미고정 픽셀을 이웃 평균으로 (라플라스 방정식의 가우스-자이델) ---
  // 마스크 픽셀은 엣지 계약 때문에 타일 변에 닿지 않으므로 이웃이 항상 존재한다
  for (let it = 0; it < RELAX_SWEEPS; it++) {
    for (let y = 1; y < T - 1; y++) {
      for (let x = 1; x < T - 1; x++) {
        const i = y * T + x;
        if (fixed[i]) continue;
        const l = (i - 1) * 3;
        const r = (i + 1) * 3;
        const u = (i - T) * 3;
        const d = (i + T) * 3;
        const o = i * 3;
        field[o] = (field[l] + field[r] + field[u] + field[d]) * 0.25;
        field[o + 1] = (field[l + 1] + field[r + 1] + field[u + 1] + field[d + 1]) * 0.25;
        field[o + 2] = (field[l + 2] + field[r + 2] + field[u + 2] + field[d + 2]) * 0.25;
      }
    }
  }
}

/**
 * 정규 텍스처 안쪽에 크롭을 이식한 변형 하나를 만든다.
 *
 * 변에서 `EDGE_HOLD_PX` 픽셀까지는 정규 텍스처가 **그대로 복사**되므로 변 픽셀은 정규와
 * 비트 단위로 같다 → 엣지 계약. 그 안쪽은 최소오차 컷을 따라 크롭으로 갈아타고, 컷 위의
 * 값 차이는 그래디언트 도메인 막이 흡수한다 → 이음매 없음.
 *
 * @param canonical 정규 텍스처 (wrap 연속, RGBA)
 * @param crop      얹을 크롭 (같은 크기, RGBA)
 * @param T         한 변
 */
export function graftInterior(
  canonical: Uint8ClampedArray,
  crop: Uint8ClampedArray,
  T: number
): Uint8ClampedArray {
  const band = bandWidth(T);
  const minD = EDGE_HOLD_PX;
  const maxD = band - 1;

  const err = (x: number, y: number): number => pixelError(canonical, crop, (y * T + x) * 4);

  // 1) 네 변 각각의 최소오차 컷
  const dTop = solveCutDepths(T, minD, maxD, (x, d) => err(x, d));
  const dBottom = solveCutDepths(T, minD, maxD, (x, d) => err(x, T - 1 - d));
  const dLeft = solveCutDepths(T, minD, maxD, (y, d) => err(d, y));
  const dRight = solveCutDepths(T, minD, maxD, (y, d) => err(T - 1 - d, y));

  // 2) 마스크 — 네 컷의 안쪽 교집합만 크롭이 된다
  const fixed = new Uint8Array(T * T);
  let cropPixels = 0;
  for (let y = 0; y < T; y++) {
    for (let x = 0; x < T; x++) {
      const inside =
        y > dTop[x] && T - 1 - y > dBottom[x] && x > dLeft[y] && T - 1 - x > dRight[y];
      fixed[y * T + x] = inside ? 0 : 1;
      if (inside) cropPixels++;
    }
  }

  const out = new Uint8ClampedArray(canonical.length);
  // 컷이 전부 닫혀 크롭 영역이 없으면(병적인 입력) 정규를 그대로 돌려준다
  if (cropPixels === 0) {
    out.set(canonical);
    return out;
  }

  // 3) 막 u: 고정(정규) 픽셀에서 canonical - crop, 나머지는 조화 확장
  const field = new Float32Array(T * T * 3);
  for (let i = 0, p = 0; i < T * T; i++, p += 4) {
    if (!fixed[i]) continue;
    field[i * 3] = canonical[p] - crop[p];
    field[i * 3 + 1] = canonical[p + 1] - crop[p + 1];
    field[i * 3 + 2] = canonical[p + 2] - crop[p + 2];
  }
  diffuseMembrane(T, fixed, field);

  // 4) 합성 — 바깥은 정규 원본 복사, 안쪽은 crop + u
  for (let i = 0, p = 0; i < T * T; i++, p += 4) {
    if (fixed[i]) {
      out[p] = canonical[p];
      out[p + 1] = canonical[p + 1];
      out[p + 2] = canonical[p + 2];
    } else {
      out[p] = crop[p] + field[i * 3];
      out[p + 1] = crop[p + 1] + field[i * 3 + 1];
      out[p + 2] = crop[p + 2] + field[i * 3 + 2];
    }
    out[p + 3] = 255;
  }
  return out;
}
