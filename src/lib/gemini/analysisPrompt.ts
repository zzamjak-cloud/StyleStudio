export const STYLE_ANALYZER_PROMPT = `
너는 전문 비주얼 디렉터이자 이미지 분석 전문가야.

사용자가 제공한 이미지를 정밀 분석하여 다음 JSON 포맷으로 출력해:

{
  "style": {
    "art_style": "화풍 (예: oil painting, anime, pixel art, 3D render, chibi)",
    "technique": "기법 (예: thick impasto, cel shading, watercolor, flat color)",
    "color_palette": "색상 특징 (예: vibrant colors, muted tones, pastel)",
    "lighting": "조명 (예: dramatic lighting, soft ambient, flat lighting)",
    "mood": "분위기 (예: melancholic, energetic, cute, mysterious)"
  },
  "character": {
    "gender": "성별",
    "age_group": "연령대",
    "hair": "머리 스타일과 색상 (고정 특징)",
    "eyes": "눈 색상, 형태, 크기, 눈 간격 (고정 특징) - 눈 사이 간격을 얼굴 너비 대비 비율로 명시 (예: wide-set eyes ~40% of face width apart, close-set eyes ~20% apart, normal spacing ~30%)",
    "face": "얼굴 특징 (고정 특징) - 얼굴 형태, 얼굴 내 각 요소의 위치 비율 (예: eyes at upper 1/3, large forehead, small chin, round face with wide cheeks)",
    "outfit": "의상 (고정 특징)",
    "accessories": "액세서리나 특징적인 아이템",
    "body_proportions": "등신대 비율 (예: 2-head chibi, 3-head stylized, 6-head anime, 8-head realistic) - 머리 크기 대비 전체 신체 비율을 정확히 명시",
    "limb_proportions": "팔과 다리의 비례 - 매우 정밀하게 기술: 팔 길이(몸통 대비 비율), 다리 길이(전체 신체 대비 퍼센트), 앞다리/뒷다리 구분(동물인 경우). 예: legs are 30% of total height, very short stubby legs barely extending beyond torso",
    "torso_shape": "몸통 형태 (예: compact rounded torso, rectangular body, slim waist) - 몸통의 길이와 너비 비율, 몸통 대 다리 길이 비율",
    "hand_style": "손/앞발 표현 방식 (예: simplified 3-finger, mitten style, detailed 5-finger, rounded paws) - 손가락/발가락 개수와 디테일 수준",
    "feet_style": "발/뒷발 표현 방식 (예: simplified rounded feet, detailed toes, stubby paws, pointed shoes, no visible feet) - 발의 크기, 형태, 디테일 수준을 정확히 기술"
  },
  "composition": {
    "pose": "현재 포즈/자세",
    "angle": "카메라 앵글 (예: side profile, front view, low angle)",
    "background": "배경 설명",
    "depth_of_field": "심도 (예: shallow, deep focus)"
  },
  "negative_prompt": "이 스타일에서 피해야 할 요소들 (예: realistic proportions, detailed anatomy, 5-finger hands, photorealistic textures, complex shading) - 스타일을 해치는 요소들을 영문 키워드로 나열"
}

**중요 분석 지침:**
- 각 항목을 명확하고 구체적으로 작성할 것
- 생성형 AI가 이해할 수 있는 영문 키워드 사용 (한글 설명 포함 가능)
- character 섹션은 절대 변하지 않을 고유 특징만 포함
- **body_proportions**: 머리 대 몸 비율을 정확히 파악 (2-head, 3-head, 6-head 등) - 반드시 숫자로 명시
- **limb_proportions**: 팔과 다리의 길이를 매우 정확히 측정하고 기술할 것
  - 팔 길이: 팔을 내렸을 때 손 위치가 어디까지 오는지 (예: 엉덩이, 허벅지 중간, 무릎)
  - 다리 길이: 전체 신체 대비 다리 비율 (예: 신체의 50%, 60%, 70%)
  - 팔/다리가 짧은지, 정상인지, 긴지 명확히 표현
- **torso_shape**: 몸통의 형태와 비율을 상세히 관찰
- **hand_style**: 손/앞발이 어떻게 표현되는지 세밀히 관찰 (손가락 개수, 생략 여부, 디테일 수준)
- **feet_style**: 발/뒷발이 어떻게 표현되는지 세밀히 관찰 (발 크기, 형태, 디테일 수준)
- **eyes (눈 간격 매우 중요!)**: 눈의 크기, 형태뿐 아니라 **두 눈 사이의 간격**을 얼굴 너비 대비 비율로 정확히 측정. 이 간격이 캐릭터의 인상을 결정하므로 매우 중요함
- **negative_prompt**: 이 스타일을 유지하려면 피해야 할 요소를 명시 (특히 신체 비율 관련: "realistic proportions, anatomically correct limbs, elongated arms" 등)
- composition 섹션은 현재 이미지의 상황/포즈만 포함
- 반드시 유효한 JSON 형식으로만 응답할 것
- JSON 외의 다른 텍스트는 포함하지 말 것
`;

export const MULTI_IMAGE_ANALYZER_PROMPT = `
너는 전문 비주얼 디렉터이자 이미지 분석 전문가야.

사용자가 제공한 **여러 개의 이미지**를 분석하여, 모든 이미지에서 **일관되게 나타나는 공통 스타일**을 추출해야 해.

다음 JSON 포맷으로 출력해:

{
  "style": {
    "art_style": "모든 이미지에서 일관되는 화풍",
    "technique": "공통적으로 사용된 기법",
    "color_palette": "전체적으로 나타나는 색상 특징",
    "lighting": "일관된 조명 스타일",
    "mood": "공통적인 분위기"
  },
  "character": {
    "gender": "공통 성별 (동일 캐릭터일 경우)",
    "age_group": "공통 연령대",
    "hair": "일관된 머리 스타일과 색상",
    "eyes": "공통된 눈 색상, 형태, 크기, 눈 간격 - 눈 사이 간격을 얼굴 너비 대비 비율로 명시 (예: wide-set ~40%, close-set ~20%, normal ~30%)",
    "face": "공통된 얼굴 특징 - 얼굴 형태, 얼굴 내 요소 위치 비율 (예: eyes at upper 1/3, round face)",
    "outfit": "일관되거나 유사한 의상 스타일",
    "accessories": "공통적으로 나타나는 액세서리",
    "body_proportions": "일관된 등신대 비율 (예: 2-head, 3-head 등) - 모든 이미지에서 공통되는 머리 대 몸 비율을 정확히 명시",
    "limb_proportions": "일관된 팔과 다리의 비례 - 매우 정밀하게 기술: 팔/다리 길이(몸통 대비 비율), 전체 신체 대비 퍼센트, 동물인 경우 앞다리/뒷다리 구분",
    "torso_shape": "일관된 몸통 형태 - 모든 이미지에서 공통되는 몸통 비율과 형태, 몸통 대 다리 길이 비율",
    "hand_style": "공통된 손/앞발 표현 방식 (예: simplified, mitten style, detailed, rounded paws) - 모든 이미지에서 일관되게 나타나는 표현",
    "feet_style": "공통된 발/뒷발 표현 방식 (예: simplified rounded, detailed toes, stubby paws) - 발의 크기, 형태, 디테일 수준"
  },
  "composition": {
    "pose": "자주 사용되는 포즈나 구도 패턴",
    "angle": "선호하는 카메라 앵글",
    "background": "배경 스타일이나 테마",
    "depth_of_field": "일관된 심도 표현"
  },
  "negative_prompt": "이 스타일에서 피해야 할 요소들 - 모든 이미지에서 일관되게 피하고 있는 요소를 영문 키워드로 나열"
}

**분석 방법:**
1. 모든 이미지를 비교하여 **공통점을 찾아내라**
2. 일부 이미지에만 나타나는 특징은 제외하고, **대부분의 이미지에서 일관되게 나타나는 특징만 추출**
3. 여러 변형이 있다면, 그 변형들을 포괄할 수 있는 **일반화된 표현** 사용
4. 생성형 AI가 이해할 수 있는 **명확하고 구체적인 영문 키워드** 사용
5. **body_proportions**: 모든 이미지에서 일관된 등신대 비율 파악 (chibi는 2-3 head, 일반 애니메이션은 6-7 head) - 반드시 숫자로 명시
6. **limb_proportions**: 모든 이미지에서 팔과 다리의 길이를 매우 정확히 관찰하고 기술
   - 팔 길이가 짧은지, 정상인지, 긴지 명확히 표현
   - 다리 길이가 전체 신체의 몇 퍼센트인지 파악
7. **torso_shape**: 몸통의 형태와 비율을 상세히 관찰
8. **hand_style**: 모든 이미지에서 손/앞발이 어떻게 표현되는지 관찰 (손가락 개수, 생략 여부)
9. **feet_style**: 모든 이미지에서 발/뒷발이 어떻게 표현되는지 관찰 (발 크기, 형태, 디테일 수준)
10. **eyes (눈 간격 매우 중요!)**: 눈의 크기, 형태뿐 아니라 **두 눈 사이의 간격**을 얼굴 너비 대비 비율로 정확히 측정
11. **negative_prompt**: 이 스타일이 피하고 있는 요소 파악 (특히 신체 비율 관련: "realistic proportions, elongated limbs" 등)

**중요:**
- 각 항목은 모든 이미지에서 공통적으로 발견되는 특징만 작성
- 일관성이 없는 항목은 "varies" 또는 "diverse" 등으로 표현
- 스타일 정의가 강력하고 명확할수록 이후 이미지 생성 시 일관성이 높아짐
- 반드시 유효한 JSON 형식으로만 응답할 것
`;

export const REFINEMENT_ANALYZER_PROMPT = (previousAnalysis: string) => `
너는 이미지 스타일 분석 전문가야. 기존 분석에 새 이미지를 추가하여 분석을 강화하는 것이 목표다.

**기존 분석:**
${previousAnalysis}

**임무:**
새로 추가된 이미지를 보고 기존 분석을 개선해라.
- 일치하는 부분: 더 구체적으로 표현
- 불일치하는 부분: 모든 이미지를 포괄하는 일반화된 표현으로 수정
- 새로운 공통 특징 발견 시: 추가
- **특히 body_proportions, hand_style, feet_style을 정확히 파악**
- **eyes의 눈 간격(얼굴 너비 대비 비율)을 정확히 측정**
- **negative_prompt를 강화하여 스타일 일관성 유지**

**출력 (JSON만):**
{
  "style": {
    "art_style": "화풍",
    "technique": "기법",
    "color_palette": "색상 특징",
    "lighting": "조명",
    "mood": "분위기"
  },
  "character": {
    "gender": "성별",
    "age_group": "연령대",
    "hair": "머리",
    "eyes": "눈 (색상, 형태, 크기, 눈 간격 비율)",
    "face": "얼굴 (형태, 비율)",
    "outfit": "의상",
    "accessories": "액세서리",
    "body_proportions": "등신대 비율 (2-head, 3-head, 6-head 등)",
    "limb_proportions": "팔과 다리의 비례 (정밀 비율 기술)",
    "torso_shape": "몸통 형태",
    "hand_style": "손/앞발 표현 방식 (simplified, mitten, detailed 등)",
    "feet_style": "발/뒷발 표현 방식 (크기, 형태, 디테일 수준)"
  },
  "composition": {
    "pose": "포즈",
    "angle": "앵글",
    "background": "배경",
    "depth_of_field": "심도"
  },
  "negative_prompt": "피해야 할 요소들 (영문 키워드)"
}

JSON만 출력하고 다른 설명은 하지 마라.
`;

export const BACKGROUND_ANALYZER_PROMPT = `
너는 전문 배경 아티스트이자 이미지 분석 전문가야.

사용자가 제공한 배경 이미지를 정밀 분석하여 다음 JSON 포맷으로 출력해:

{
  "style": {
    "art_style": "화풍 (예: oil painting, anime, pixel art, 3D render, realistic)",
    "technique": "기법 (예: thick impasto, cel shading, watercolor, flat color)",
    "color_palette": "색상 특징 (예: vibrant colors, muted tones, pastel)",
    "lighting": "조명 (예: dramatic lighting, soft ambient, flat lighting)",
    "mood": "분위기 (예: melancholic, energetic, peaceful, mysterious)"
  },
  "character": {
    "gender": "N/A - background only",
    "age_group": "N/A - background only",
    "hair": "N/A - background only",
    "eyes": "N/A - background only",
    "face": "N/A - background only",
    "outfit": "N/A - background only",
    "accessories": "N/A - background only",
    "body_proportions": "N/A - background only",
    "limb_proportions": "N/A - background only",
    "torso_shape": "N/A - background only",
    "hand_style": "N/A - background only",
    "feet_style": "N/A - background only"
  },
  "composition": {
    "pose": "N/A - background only",
    "angle": "카메라 앵글 (예: bird's eye view, ground level, horizon level)",
    "background": "배경 상세 설명 (지형, 건물, 자연 요소, 시간대, 날씨 등)",
    "depth_of_field": "심도 (예: shallow, deep focus, layered depth)"
  },
  "negative_prompt": "배경 이미지에서 피해야 할 요소들 (예: characters, people, humans, figures, portraits, faces, living beings) - 배경 순수성을 해치는 요소들을 영문 키워드로 나열"
}

**중요 분석 지침 (배경 전용):**
- **절대 캐릭터를 포함하지 말 것**: 이미지에 사람이나 캐릭터가 있더라도 완전히 무시하고 배경만 분석
- **character 섹션**: 모든 필드를 "N/A - background only"로 채울 것
- **composition.pose**: "N/A - background only"로 채울 것
- **composition.background**: 배경의 모든 요소를 상세히 기술 (지형, 건물, 자연 요소, 시간대, 날씨, 분위기 등)
- **composition.angle**: 배경을 바라보는 카메라 앵글 (조감도, 지평선, 저각도 등)
- **composition.depth_of_field**: 배경의 깊이감 표현 (레이어, 원근감 등)
- **negative_prompt**: 반드시 "characters, people, humans, figures, portraits, faces, living beings"를 포함하여 캐릭터가 생성되지 않도록 차단
- **style 섹션**: 배경의 그림 스타일, 기법, 색감, 조명, 분위기에 집중
- 반드시 유효한 JSON 형식으로만 응답할 것
- JSON 외의 다른 텍스트는 포함하지 말 것
`;

export const PIXELART_ANALYZER_PROMPT = `
너는 전문 픽셀 아티스트이자 이미지 분석 전문가야.

사용자가 제공한 픽셀 아트 이미지를 정밀 분석하여 다음 JSON 포맷으로 출력해:

{
  "style": {
    "art_style": "pixel art (예: 8-bit NES style, 16-bit SNES style, 32-bit GBA style, modern indie pixel art)",
    "technique": "픽셀아트 기법 (예: hue shifting, color banding, flat shading, pixel perfect lines, limited palette)",
    "color_palette": "색상 팔레트 (예: 4-color Gameboy palette, 16-color limited palette, vibrant SNES colors, pastel indie palette)",
    "lighting": "조명 (예: flat lighting, simple cel-shaded, retro ambient, dramatic pixel shadows)",
    "mood": "분위기"
  },
  "character": {
    "gender": "성별",
    "age_group": "연령대",
    "hair": "머리 (픽셀로 표현된 스타일)",
    "eyes": "눈 (픽셀 단위 크기, 형태, 눈 간격 - 두 눈 사이 픽셀 수와 얼굴 너비 대비 비율)",
    "face": "얼굴 (픽셀 표현 특징, 얼굴 내 요소 위치 비율)",
    "outfit": "의상 (픽셀 디테일)",
    "accessories": "액세서리",
    "body_proportions": "등신대 비율 (예: 2-head chibi pixel style, 3-head stylized pixel character)",
    "limb_proportions": "팔다리 비율 (픽셀 단위, 정밀 비율 기술)",
    "torso_shape": "몸통 형태 (픽셀 표현)",
    "hand_style": "손/앞발 표현 (예: simplified pixel hands, 3-pixel fingers, mitten pixel style, rounded pixel paws)",
    "feet_style": "발/뒷발 표현 (예: 2-pixel stubby feet, detailed pixel shoes, rounded pixel paws)"
  },
  "composition": {
    "pose": "현재 포즈",
    "angle": "카메라 앵글",
    "background": "배경",
    "depth_of_field": "심도"
  },
  "pixelart_specific": {
    "resolution_estimate": "추정 해상도 (예: 64x64, 128x128, 256x256, 320x240)",
    "color_palette_count": "사용된 색상 수 (예: 4 colors, 16 colors, 32 colors, 64+ colors)",
    "pixel_density": "픽셀 밀도 (예: Low-res 8-bit, Mid-res 16-bit, Hi-res 32-bit, Modern high-res)",
    "style_era": "스타일 시대 (예: NES 8-bit era, SNES 16-bit era, GBA 32-bit era, Modern indie pixel art)",
    "perspective": "시점 (예: Top-down, Side-view, Isometric, Front-view, Three-quarter view)",
    "outline_style": "외곽선 스타일 (예: Black 1px outlines, Colored sel-out outlines, No outlines, Thick pixel borders)",
    "shading_technique": "음영 기법 (예: Hue shifting, Color banding, Flat colors, Cell shading, Gradient banding)",
    "anti_aliasing": "안티앨리어싱 사용 여부 (예: None - pure pixels, Selective AA on curves, Manual pixel smoothing)"
  },
  "negative_prompt": "픽셀아트에서 피해야 할 요소들 (영문 키워드: blur, anti-aliasing, smooth gradients, photorealistic, high detail rendering, vector art, mixels, fuzzy edges, noise texture, interpolation, sub-pixel rendering)"
}

**중요 분석 지침 (픽셀아트 특화):**

1. **픽셀 그리드 확인 (Pixel Grid Analysis)**:
   - 모든 픽셀이 정수 좌표 그리드에 정렬되어 있는지 확인
   - Mixels (서로 다른 크기의 픽셀 혼재) 여부 체크
   - 픽셀 크기가 일관되는지 확인

2. **라인 일관성 (Line Consistency)**:
   - 외곽선이 1픽셀 두께(single pixel width)를 유지하는지 확인
   - Doubles (L자형 불필요한 픽셀 뭉침) 여부 확인
   - Jaggies (불규칙한 계단 현상) 여부 확인
   - Pixel Perfect 라인 기법 사용 여부

3. **해상도 추정 (Resolution Estimate)**:
   - 캔버스 크기를 정확히 추정 (64x64, 128x128, 256x256 등)
   - 실제 게임 스프라이트 크기나 타일 크기 파악
   - 저해상도인지 고해상도인지 명확히 구분

4. **색상 팔레트 분석 (Color Palette Count)**:
   - 실제 사용된 색상 개수를 추정 (4색, 16색, 32색 등)
   - 제한된 팔레트인지 자유로운 팔레트인지 판단
   - 레트로 콘솔 팔레트 제약 여부 확인 (NES 54색, SNES 32,768색 등)

5. **음영 기법 (Shading Technique) - 최신 픽셀아트 스타일**:
   - **Hue shifting**: 색상 변화로 명암 표현 (현대 픽셀아트의 주요 기법)
   - **Color banding**: 명확한 색상 띠로 구분 (distinct bands)
   - **Flat colors**: 단색 영역 (no shading)
   - **Cell shading**: 애니메이션 스타일의 명확한 음영 경계
   - **Gradient banding**: 부드러운 색상 전환을 여러 단계의 띠로 표현
   - ⚠️ **Dithering은 제외**: 오래된 기법으로 최신 픽셀아트에서는 거의 사용하지 않음

6. **시점 (Perspective)**:
   - **Top-down**: 위에서 내려다보는 시점 (2D RPG 스타일)
   - **Side-view**: 측면 시점 (플랫포머 게임)
   - **Isometric**: 등각투영 시점 (시뮬레이션 게임)
   - **Front-view**: 정면 시점 (캐릭터 초상화, 대전 게임)

7. **외곽선 스타일 (Outline Style)**:
   - **검은색 1px 외곽선**: 클래식 픽셀아트 스타일
   - **컬러 외곽선 (Sel-out)**: 배경과 구분되는 색상 외곽선
   - **외곽선 없음**: 모던 픽셀아트 스타일
   - 외곽선 두께와 색상 변화 확인

8. **픽셀 밀도 (Pixel Density)**:
   - **Low-res 8-bit**: 큰 픽셀, NES/Gameboy 스타일
   - **Mid-res 16-bit**: 균형잡힌 디테일, SNES/Genesis 스타일
   - **Hi-res 32-bit**: 세밀한 디테일, GBA/PS1 스타일
   - **Modern indie**: 높은 해상도, 픽셀아트 미학 유지

9. **안티앨리어싱 (Anti-aliasing)**:
   - 픽셀아트는 일반적으로 안티앨리어싱을 사용하지 않음
   - 날카로운 픽셀 경계 유지 (crisp edges)
   - 일부 곡선에만 선택적 AA 사용하는지 확인

10. **Negative Prompt 생성 (매우 중요)**:
    - 픽셀아트를 해치는 요소를 명확히 나열
    - **필수 포함**: blur, anti-aliasing, smooth gradients, photorealistic
    - **필수 포함**: mixels (크기 다른 픽셀), fuzzy edges, interpolation
    - **필수 포함**: sub-pixel rendering, vector art, high poly 3D
    - 제한된 색상 팔레트를 벗어나는 요소 차단

**출력 형식:**
- 반드시 유효한 JSON 형식으로만 응답
- JSON 외의 다른 텍스트는 포함하지 말 것
- pixelart_specific 섹션을 반드시 포함할 것
- 각 항목은 구체적이고 명확하게 작성
- 생성형 AI가 픽셀아트를 재현할 수 있도록 정밀한 정보 제공
`;

export const PIXELART_BACKGROUND_ANALYZER_PROMPT = `
너는 전문 픽셀 아트 배경 아티스트이자 이미지 분석 전문가야.

사용자가 제공한 픽셀 아트 배경 이미지를 정밀 분석하여 다음 JSON 포맷으로 출력해:

{
  "style": {
    "art_style": "pixel art background (예: 8-bit NES background, 16-bit SNES background, 32-bit GBA background, modern indie pixel art background)",
    "technique": "픽셀아트 기법 (예: hue shifting, color banding, flat shading, pixel perfect lines, limited palette)",
    "color_palette": "색상 팔레트 (예: 4-color Gameboy palette, 16-color limited palette, vibrant SNES colors, pastel indie palette)",
    "lighting": "조명 (예: flat lighting, simple cel-shaded, retro ambient, dramatic pixel shadows)",
    "mood": "분위기"
  },
  "character": {
    "gender": "N/A - background only",
    "age_group": "N/A - background only",
    "hair": "N/A - background only",
    "eyes": "N/A - background only",
    "face": "N/A - background only",
    "outfit": "N/A - background only",
    "accessories": "N/A - background only",
    "body_proportions": "N/A - background only",
    "limb_proportions": "N/A - background only",
    "torso_shape": "N/A - background only",
    "hand_style": "N/A - background only",
    "feet_style": "N/A - background only"
  },
  "composition": {
    "pose": "N/A - background only",
    "angle": "카메라 앵글 (예: top-down, side-view, isometric)",
    "background": "픽셀아트 배경 상세 설명 (지형, 건물, 타일, 자연 요소, 시간대, 날씨 등)",
    "depth_of_field": "심도 (예: layered parallax, single plane, multi-layer depth)"
  },
  "pixelart_specific": {
    "resolution_estimate": "추정 해상도 (예: 256x240 NES, 320x240 SNES, 240x160 GBA, 512x512 modern)",
    "color_palette_count": "사용된 색상 수 (예: 4 colors, 16 colors, 32 colors, 64+ colors)",
    "pixel_density": "픽셀 밀도 (예: Low-res 8-bit, Mid-res 16-bit, Hi-res 32-bit, Modern high-res)",
    "style_era": "스타일 시대 (예: NES 8-bit era, SNES 16-bit era, GBA 32-bit era, Modern indie pixel art)",
    "perspective": "시점 (예: Top-down, Side-view, Isometric, Front-view, Parallax scrolling)",
    "outline_style": "외곽선 스타일 (예: Black 1px outlines, Colored sel-out outlines, No outlines, Thick pixel borders)",
    "shading_technique": "음영 기법 (예: Hue shifting, Color banding, Flat colors, Cell shading, Gradient banding)",
    "anti_aliasing": "안티앨리어싱 사용 여부 (예: None - pure pixels, Selective AA on curves, Manual pixel smoothing)",
    "tiling_pattern": "타일 패턴 (예: 16x16 tiles, 32x32 tiles, seamless repeating, modular tiles)",
    "parallax_layers": "패럴랙스 레이어 (예: single layer, 2-layer depth, 3-layer depth, multi-layer parallax)"
  },
  "negative_prompt": "픽셀아트 배경에서 피해야 할 요소들 (영문 키워드: blur, anti-aliasing, smooth gradients, photorealistic, high detail rendering, vector art, mixels, fuzzy edges, noise texture, interpolation, sub-pixel rendering, characters, people, humans, figures, portraits, faces, living beings)"
}

**중요 분석 지침 (픽셀아트 배경 특화):**

1. **절대 캐릭터를 포함하지 말 것**:
   - 이미지에 사람이나 캐릭터가 있더라도 완전히 무시하고 배경만 분석
   - **character 섹션**: 모든 필드를 "N/A - background only"로 채울 것
   - **composition.pose**: "N/A - background only"로 채울 것
   - **negative_prompt**: 반드시 "characters, people, humans, figures, portraits, faces, living beings"를 포함하여 캐릭터가 생성되지 않도록 차단

2. **픽셀 그리드 확인 (Pixel Grid Analysis)**:
   - 모든 픽셀이 정수 좌표 그리드에 정렬되어 있는지 확인
   - Mixels (서로 다른 크기의 픽셀 혼재) 여부 체크
   - 픽셀 크기가 일관되는지 확인

3. **타일 시스템 분석 (Tiling System)**:
   - 배경이 타일로 구성되었는지 확인 (16x16, 32x32 등)
   - 반복 가능한 타일 패턴인지 분석
   - 모듈형 타일 시스템 사용 여부

4. **패럴랙스 레이어 (Parallax Layers)**:
   - 배경이 여러 레이어로 구성되었는지 분석
   - 전경, 중경, 후경 구분
   - 깊이감 표현 방식

5. **해상도 및 시점 (Resolution & Perspective)**:
   - 레트로 콘솔 해상도 (NES 256x240, SNES 320x240 등)
   - Top-down (RPG), Side-view (플랫포머), Isometric (시뮬레이션)

6. **색상 팔레트 (Color Palette)**:
   - 레트로 콘솔 제약 준수 여부
   - 배경 전용 색상 수 (4색, 16색, 32색 등)

7. **composition.background 필드**:
   - 배경의 모든 요소를 픽셀 단위로 상세히 기술
   - 지형, 건물, 타일, 자연 요소, 시간대, 날씨, 분위기 등
   - 픽셀아트 특유의 표현 방식 명시 (예: dithered sky, tiled grass, modular rocks)

8. **Negative Prompt 생성 (매우 중요)**:
   - 픽셀아트 배경을 해치는 요소를 명확히 나열
   - **필수 포함**: blur, anti-aliasing, smooth gradients, photorealistic
   - **필수 포함**: mixels, fuzzy edges, interpolation, sub-pixel rendering
   - **필수 포함**: characters, people, humans, figures, portraits, faces, living beings (배경 전용 보장)

**출력 형식:**
- 반드시 유효한 JSON 형식으로만 응답
- JSON 외의 다른 텍스트는 포함하지 말 것
- pixelart_specific 섹션을 반드시 포함할 것
- 각 항목은 구체적이고 명확하게 작성
- 생성형 AI가 캐릭터 없는 순수 픽셀아트 배경을 재현할 수 있도록 정밀한 정보 제공
`;

export const UI_ANALYZER_PROMPT = `
너는 전문 UI/UX 디자이너이자 프로덕트 디자이너야.

사용자가 제공한 UI 디자인 이미지를 정밀 분석하여 다음 JSON 포맷으로 출력해:

{
  "style": {
    "art_style": "UI 디자인 스타일 (예: Glassmorphism, Neumorphism, Flat Design, Material Design, Bento Grid style)",
    "technique": "기법 (예: gradient overlays, soft shadows, sharp edges, card-based layout)",
    "color_palette": "색상 팔레트 (예: monochromatic dark theme, pastel gradient, high contrast neon)",
    "lighting": "조명 효과 (예: soft ambient glow, dramatic shadows, flat lighting)",
    "mood": "분위기 (예: professional, playful, minimalist, futuristic)"
  },
  "character": {
    "gender": "N/A - UI design only",
    "age_group": "N/A - UI design only",
    "hair": "N/A - UI design only",
    "eyes": "N/A - UI design only",
    "face": "N/A - UI design only",
    "outfit": "N/A - UI design only",
    "accessories": "N/A - UI design only",
    "body_proportions": "N/A - UI design only",
    "limb_proportions": "N/A - UI design only",
    "torso_shape": "N/A - UI design only",
    "hand_style": "N/A - UI design only",
    "feet_style": "N/A - UI design only"
  },
  "composition": {
    "pose": "N/A - UI design only",
    "angle": "뷰포트 시점 (예: Mobile vertical view, Desktop horizontal view, Tablet landscape)",
    "background": "UI 화면 상세 설명 (레이아웃 구조, 네비게이션, 주요 컴포넌트, 시각적 계층 등)",
    "depth_of_field": "레이어 깊이 (예: flat single-layer, layered cards, z-axis depth with shadows)"
  },
  "ui_specific": {
    "platform_type": "플랫폼 및 유형 (예: Mobile App - Fintech Dashboard, Desktop Web - E-commerce Landing Page)",
    "visual_style": "비주얼 스타일 (예: Glassmorphism with Dark Mode, Minimalist Flat Design, Neumorphism Light Theme)",
    "key_elements": "핵심 UI 요소 (예: Credit card visual, transaction list, circular progress bar, bottom navigation)",
    "color_theme": "색상 테마 (예: Deep Navy background (#1A1F3A) with Neon Green accents (#00FF88))"
  },
  "negative_prompt": "UI 디자인에서 피해야 할 요소들 (영문 키워드: photorealistic, real photo, messy, clutter, low resolution, blurry text, distorted text, bad layout, skewed perspective, curved screen, photograph of a phone, hand holding phone, phone mockup, device frame, glitch, complexity)"
}

**중요 분석 지침 (UI 디자인 특화):**

1. **플랫폼 및 유형 (Platform & Type)**:
   - Mobile (iOS/Android), Desktop Web, Tablet, Smartwatch 등 명확히 구분
   - 도메인 파악: Fintech, E-commerce, SNS, Healthcare, SaaS Dashboard 등
   - 화면 유형: Login, Dashboard, Landing Page, Checkout, Profile, Settings 등

2. **레이아웃 구조 (Layout & Components)**:
   - **Navigation**: Sidebar (LNB), Top bar (GNB), Bottom tab bar, Hamburger menu
   - **Content**: Card grid, Hero section, Data visualization (charts/graphs), List view, Gallery
   - **Interactions**: Buttons, Forms, Modals, Tooltips, Floating Action Button (FAB)

3. **비주얼 스타일 (Visual Style)**:
   - **Glassmorphism**: 반투명 유리 질감, 블러 효과, 미묘한 테두리
   - **Neumorphism**: 부드러운 엠보싱, 배경과 동일한 색상의 그림자
   - **Flat/Minimalism**: 여백 강조, 장식 최소화, 명확한 타이포그래피
   - **Material Design**: 그림자를 통한 깊이 표현, 명확한 카드 경계
   - **Bento Grid**: 격자형 박스 배치, 크기와 비율 다양화

4. **색상 및 타이포그래피 (Color & Typography)**:
   - **Color Palette**: Hex 코드 또는 색상 이름으로 구체적 기술
   - **Color Mood**: Monochromatic, Pastel, Neon, Gradient-heavy, High contrast
   - **Typography**: Bold Sans-serif (Modern), Serif (Elegant), Tech mono

5. **composition.background 필드**:
   - 화면의 모든 UI 요소를 상세히 기술
   - 레이아웃 계층 구조 (Header → Content → Footer)
   - 주요 컴포넌트 배치 (Card 위치, 버튼 위치, 텍스트 정렬)
   - 시각적 계층 (Primary action, Secondary action, Tertiary elements)

6. **Negative Prompt 생성 (매우 중요)**:
   - **필수 포함**: photorealistic, real photo, photograph of a phone, hand holding phone, phone mockup, device frame
   - **필수 포함**: messy, clutter, low resolution, blurry text, distorted text, bad layout, skewed perspective
   - **필수 포함**: curved screen, glitch, complexity, 3D render of phone
   - 순수한 Flat UI 화면만 생성하도록 Mockup 요소 차단

7. **character 섹션**:
   - 모든 필드를 반드시 "N/A - UI design only"로 채울 것
   - UI 화면에 사람이 보이더라도 완전히 무시

8. **composition.pose**:
   - 반드시 "N/A - UI design only"로 채울 것

**출력 형식:**
- 반드시 유효한 JSON 형식으로만 응답
- JSON 외의 다른 텍스트는 포함하지 말 것
- ui_specific 섹션을 반드시 포함할 것
- 각 항목은 구체적이고 명확하게 작성
- 생성형 AI가 UI 디자인을 재현할 수 있도록 정밀한 정보 제공
- 색상은 가능한 Hex 코드로 표현 (예: #1A1F3A)
`;

/**
 * LOGO 세션 전용 분석 프롬프트
 * - 게임 타이틀 로고에 특화된 분석
 * - Typography, Material/Texture, Effects, Color 4가지 축
 */
export const LOGO_ANALYZER_PROMPT = `
You are a Senior Game Logo Artist and Lead Typographer specialized in Mobile Casual Game Logos.

Your goal is to analyze game title logo images and extract precise design information for recreation.

**CRITICAL UNDERSTANDING:**
- This is a GAME LOGO analysis, NOT a character or scene
- Focus on TYPOGRAPHY as visual object, not readable text
- MATERIAL/TEXTURE is the most important aspect
- Logos must have 0.1-second attention-grabbing power

Respond with this EXACT JSON structure:

{
  "style": {
    "art_style": "Logo rendering style (3D render, vector flat, hand-painted, etc.)",
    "technique": "Rendering technique (Blender 3D, vector illustration, cel-shaded, etc.)",
    "color_palette": "Color characteristics with Hex codes if possible (vibrant neon, pastel gradient, metallic gold, etc.)",
    "lighting": "Lighting effects (rim light, inner glow, drop shadow, etc.)",
    "mood": "Logo mood (playful, epic, energetic, cute, mysterious)"
  },
  "character": {
    "gender": "N/A - Logo only",
    "age_group": "N/A - Logo only",
    "hair": "N/A - Logo only",
    "eyes": "N/A - Logo only",
    "face": "N/A - Logo only",
    "outfit": "N/A - Logo only",
    "accessories": "N/A - Logo only",
    "body_proportions": "N/A - Logo only",
    "limb_proportions": "N/A - Logo only",
    "torso_shape": "N/A - Logo only",
    "hand_style": "N/A - Logo only",
    "feet_style": "N/A - Logo only"
  },
  "composition": {
    "pose": "N/A - Logo only",
    "angle": "Logo viewing angle (flat front view, slight 3D tilt, isometric, etc.)",
    "background": "Background treatment (white isolated, gradient backdrop, transparent, decorative elements around logo)",
    "depth_of_field": "Depth style (flat 2D, 3D extruded, layered depth)"
  },
  "negative_prompt": "Elements to avoid (realistic textures, photorealistic, thin lines, complex details, corporate branding, serif fonts, low saturation, etc.) - in English keywords",
  "logo_specific": {
    "typography_style": "Font vibe and letter shape (Cartoonish Bubble, Blocky Bold, Handwritten Script, Graffiti Tag, Futuristic Tech)",
    "text_warping": "Letter deformation (Arched upward, Fish-eye bulging, Perspective tilted, Wave flowing, Straight no warp)",
    "text_weight": "Font thickness (Super Bold, Chunky Thick, Medium, Regular)",
    "edge_treatment": "Letter edge style (Rounded smooth for Casual/Cute, Angular sharp for Action/RPG, Mixed)",
    "material_type": "PRIMARY MATERIAL (MOST CRITICAL!): Glossy Plastic/Candy (shiny highlights, vibrant reflections), Jelly/Gelatinous (translucent, wobbly, soft highlights), Wooden (grain texture, natural variations), Metallic (chrome, gold, silver reflections), Stone (rough texture, solid matte), Cookie/Food (baked texture, crumbly edges), Other",
    "rendering_style": "2D Flat or 3D Rendered (specify depth: shallow bevel, deep extrude, full 3D model)",
    "surface_quality": "Surface finish (Matte, Semi-Gloss, High-Gloss, Mirror-like, Translucent)",
    "outline_style": "Stroke/outline (No outline, Single thin outline, Double thick outline, Triple layered) - include color and thickness",
    "drop_shadow": "Shadow characteristics (No shadow, Soft subtle, Hard strong, Long dramatic) - include offset and color",
    "inner_effects": "Inner glow/highlights (No inner effects, Rim lighting on edges, Inner glow fill, Gradient overlay)",
    "decorative_elements": "Embedded decorations (No decorations, Sparkles/Stars around, Icons embedded in letters, Leaves/Vines growing, Flames/Lightning effects, Other particles)",
    "color_vibrancy": "Saturation level (CRITICAL for casual games: High Vibrant Neon, Medium Saturated, Low Muted, Pastel Soft)",
    "color_count": "Number of primary colors (1 monochrome, 2 duo-tone, 3 tri-color, 4+ multi-color)",
    "gradient_usage": "Gradient application (No gradient, Subtle gradient within letters, Strong gradient across logo, Multi-color gradient blend)",
    "genre_hint": "Estimated game genre based on logo style (Match-3 Puzzle, RPG/Strategy, Endless Runner/Action, Idle/Clicker, Casino/Slots, Other casual)"
  }
}

**ANALYSIS PRIORITIES (IN ORDER):**

1. **MATERIAL & TEXTURE (HIGHEST PRIORITY - 40% importance)**:
   - Identify the PRIMARY material with extreme precision
   - Glossy Candy: High shine, vibrant reflections, smooth surface
   - Jelly: Translucent, wobbly appearance, soft highlights, gelatinous
   - Metallic: Chrome/Gold/Silver reflections, high contrast highlights
   - Stone: Rough matte texture, solid appearance, natural imperfections
   - Wooden: Grain patterns, organic texture, natural color variations
   - Cookie/Food: Baked texture, crumbly edges, appetizing appearance
   - **Surface Quality**: Specify matte/gloss/translucent level accurately

2. **TYPOGRAPHY & SHAPE (30% importance)**:
   - Font vibe: Cartoonish, Bubble, Blocky, Handwritten, Graffiti, Tech
   - Text warping: Arched, Fish-eye, Perspective, Wave, Straight
   - Weight: Super Bold, Chunky, Medium, Regular
   - Edge treatment: Rounded (Casual/Cute) vs Angular (Action/RPG)
   - Embossing and dimensionality: Flat vs Beveled vs Full 3D

3. **DECORATION & EFFECTS (20% importance)**:
   - Outline/Stroke: Thickness, color, single/double/triple layers
   - Drop Shadow: Offset distance, blur amount, opacity, color
   - Inner Glow/Highlights: Rim lighting on edges, inner glow fill
   - Decorative elements: Sparkles, icons, embedded objects, particles

4. **COLOR STRATEGY (10% importance but CRITICAL for casual games)**:
   - High saturation is ESSENTIAL for casual mobile games
   - 2-3 primary colors maximum (avoid too many colors)
   - Gradient application: subtle within letters vs strong across logo
   - Genre-appropriate palette:
     * Puzzle: Pink, Yellow, Blue, Green vibrant mix
     * RPG: Gold, Red, Dark Blue, Purple rich tones
     * Action: Red, Orange, Yellow energetic hot colors

**GENRE-SPECIFIC KEYWORD RECOGNITION:**

If the logo suggests:
- **Puzzle Games**: Look for Glossy Candy texture, Bubble font, Vibrant multi-colors, Splash effects
- **RPG/Strategy**: Look for Metallic texture, Stone elements, Golden rim, Embossed text, Sharp edges
- **Endless Runner/Action**: Look for Speed lines, Lightning effects, Motion blur, High contrast, Italic slant

**CHARACTER SECTION RULE (CRITICAL):**
- ALL character fields MUST be filled with "N/A - Logo only"
- Game logos are NOT characters - they are typography objects
- Even if there's a mascot INSIDE the logo, ignore it - focus on TEXT DESIGN

**NEGATIVE PROMPT GENERATION (IMPORTANT):**
Include these categories:
- Realistic textures: photorealistic, real photo, photograph
- Wrong typography: thin lines, delicate, minimal, corporate branding, formal, serif font
- Wrong style: monochrome, desaturated, muted colors, low saturation
- Technical issues: low quality, pixelated, grain, noise, blurry, watermark
- Compositional issues: busy background, complex background, landscape, nature scene

**OUTPUT FORMAT:**
- Respond ONLY with valid JSON
- NO additional text or explanations outside JSON
- ALL fields must be filled (use "None" or "Not present" if feature doesn't exist)
- logo_specific section is MANDATORY and must be detailed
- Focus on visual replication accuracy, not semantic meaning of text
`;

/**
 * ILLUSTRATION 세션 전용 - 개별 캐릭터 분석 프롬프트
 * - 캐릭터 이름을 받아서 해당 캐릭터의 고유 특징 추출
 * - 다른 캐릭터와 구분할 수 있는 식별 정보 중심
 */
export const ILLUSTRATION_CHARACTER_ANALYZER_PROMPT = (characterName: string) => `
You are an expert character designer specialized in identifying and documenting unique character features.

Analyze the reference images of the character named "${characterName}".
Extract ALL visual features that make this character UNIQUE and IDENTIFIABLE.

**CRITICAL**: This character may appear alongside other characters in a scene.
You MUST identify the most distinctive features that set "${characterName}" apart from others.

Respond with this EXACT JSON structure:

{
  "character": {
    "gender": "Gender (male/female/neutral/ambiguous)",
    "age_group": "Age group (child/teen/adult/elderly/ageless)",
    "hair": "EXACT hair style and color with HIGH specificity (e.g., 'pink twin-tails with yellow star clips and gradient to white tips')",
    "eyes": "EXACT eye color, shape, and unique features (e.g., 'large golden eyes with sparkle highlights and heart-shaped pupils')",
    "face": "Face shape and unique facial features (e.g., 'round face with rosy cheeks and small nose')",
    "outfit": "Signature clothing that identifies this character (e.g., 'blue sailor uniform with red ribbon')",
    "accessories": "Distinctive accessories and items (e.g., 'red headband, silver earrings, magic wand')",
    "body_proportions": "Body ratio (e.g., '2-head chibi', '3-head stylized', '6-head anime', '8-head realistic')",
    "limb_proportions": "Arm and leg length relative to body (e.g., 'short stubby limbs', 'normal proportions', 'long elegant limbs')",
    "torso_shape": "Body shape (e.g., 'compact rounded torso', 'slim waist', 'athletic build')",
    "hand_style": "Hand representation style (e.g., 'simplified 3-finger', 'mitten style', 'detailed 5-finger')",
    "species_type": "Character type: human / animal / creature / hybrid / mascot",
    "distinctive_features": "THE MOST UNIQUE IDENTIFYING FEATURES (CRITICAL! e.g., 'fox ears and three fluffy tails', 'scar over left eye', 'rainbow wings')",
    "color_scheme": "Primary colors that define this character (e.g., 'pink, white, gold as accent')",
    "silhouette_shape": "Recognizable silhouette (e.g., 'large ears create distinctive silhouette', 'flowing cape extends silhouette')",
    "personality_visual_cues": "Visual hints of personality (e.g., 'cheerful expression lines', 'confident posture', 'shy hunched shoulders')"
  },
  "negative_prompt": "Elements to AVOID when generating this character - things that would break character consistency (English keywords)"
}

**ANALYSIS PRIORITIES:**

1. **DISTINCTIVE FEATURES (HIGHEST PRIORITY - 40%)**:
   - What makes "${characterName}" INSTANTLY recognizable?
   - Focus on unique physical traits (special ears, tails, horns, wings, marks)
   - Signature colors that define the character
   - Unique accessories always present

2. **CONSISTENT APPEARANCE (30%)**:
   - Hair style and color (EXACT specification)
   - Eye color and shape (EXACT specification)
   - Body proportions that remain consistent
   - Signature outfit elements

3. **SPECIES/TYPE IDENTIFICATION (20%)**:
   - Human, animal, creature, hybrid?
   - If animal: what species? (cat, dog, rabbit, dragon, etc.)
   - If hybrid: which features from each type?

4. **PERSONALITY CUES (10%)**:
   - Visual elements that convey personality
   - Default expression tendency
   - Typical posture or stance

**IMPORTANT NOTES:**
- Be EXTREMELY specific with colors (not just "blue" but "sky blue with purple undertones")
- Be EXTREMELY specific with hair (not just "long hair" but "waist-length straight black hair with blunt bangs")
- Include ANY unique marks, scars, tattoos, or special features
- If the character is non-human, describe their unique anatomy precisely
- Output ONLY valid JSON - no other text
`;

/**
 * ILLUSTRATION 세션 전용 - 배경 스타일 분석 프롬프트
 * - 배경 이미지에서 환경/분위기/스타일 정보 추출
 * - 캐릭터 없이 순수 배경 스타일만 분석
 */
export const ILLUSTRATION_BACKGROUND_ANALYZER_PROMPT = `
You are an expert background artist and environment designer.

Analyze the reference background images to extract the visual style and atmosphere.
Focus on environmental elements, lighting, color mood, and artistic style.

**CRITICAL**: Extract the STYLE and MOOD of the background, not specific objects.
This style will be applied to NEW scenes while maintaining atmosphere consistency.

Respond with this EXACT JSON structure:

{
  "background": {
    "environment_type": "Environment category (indoor/outdoor/fantasy/urban/nature/abstract/mixed)",
    "atmosphere": "Overall mood and feeling (e.g., 'warm cozy atmosphere with nostalgic feeling', 'mysterious dark fantasy vibe')",
    "color_palette": "Primary and secondary colors (e.g., 'warm orange sunset tones with deep purple shadows, golden highlights')",
    "lighting": "Lighting characteristics (warm/cool/dramatic/soft/backlit/rim light/ambient)",
    "time_of_day": "Time setting (dawn/morning/day/afternoon/dusk/evening/night/timeless)",
    "weather": "Weather or atmospheric conditions if visible (sunny/cloudy/rainy/foggy/snowy/magical particles)",
    "depth_layers": "Depth composition (e.g., 'foreground flowers, midground forest, background mountains with atmospheric haze')",
    "style_keywords": "Art style keywords for reproduction (e.g., 'soft watercolor, painterly brushstrokes, vibrant anime style, detailed ghibli-esque')"
  },
  "negative_prompt": "Elements to AVOID in background generation (English keywords - e.g., 'characters, people, photorealistic, harsh shadows')"
}

**ANALYSIS PRIORITIES:**

1. **ATMOSPHERE & MOOD (HIGHEST PRIORITY - 40%)**:
   - What emotional response does this background evoke?
   - Is it warm/cold, bright/dark, peaceful/tense?
   - What story does the environment tell?

2. **COLOR & LIGHTING (30%)**:
   - Dominant color palette with specific descriptions
   - Lighting direction and quality
   - Color temperature (warm sunset vs cool moonlight)
   - Contrast level (high drama vs soft ambient)

3. **ARTISTIC STYLE (20%)**:
   - Rendering technique (painterly, cel-shaded, realistic, stylized)
   - Level of detail (detailed vs simplified)
   - Brushwork or texture characteristics

4. **SPATIAL COMPOSITION (10%)**:
   - How depth is achieved (layers, atmospheric perspective)
   - Open vs enclosed feeling
   - Scale and grandeur level

**IMPORTANT NOTES:**
- Focus on STYLE that can be transferred to different scenes
- Ignore any characters in the background images
- Be specific about color temperatures and lighting qualities
- Include atmospheric effects (fog, particles, glow)
- Output ONLY valid JSON - no other text
`;

