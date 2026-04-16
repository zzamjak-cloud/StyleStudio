/**
 * 픽셀 아트 이미지를 Nearest Neighbor (최단입점 보간법)로 업스케일링
 *
 * 이 방식은 픽셀이 뭉개지지 않고 날카로운 픽셀 경계를 유지합니다.
 * Bilinear나 Bicubic 보간법과 달리 픽셀 아트의 미학을 보존합니다.
 *
 * @param imageDataUrl - Base64 data URL 형식의 원본 이미지
 * @param scaleFactor - 확대 배율 (2 = 2배, 4 = 4배 등)
 * @returns Promise<string> - 업스케일링된 이미지의 Base64 data URL
 */
export async function upscalePixelArt(
  imageDataUrl: string,
  scaleFactor: number = 2
): Promise<string> {
  return new Promise((resolve, reject) => {
    // 1. Image 객체 생성
    const img = new Image();

    img.onload = () => {
      try {
        // 2. Canvas 생성 (업스케일링된 크기)
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');

        if (!ctx) {
          throw new Error('Canvas 2D context를 가져올 수 없습니다');
        }

        // 3. 업스케일링된 크기 계산
        const scaledWidth = img.width * scaleFactor;
        const scaledHeight = img.height * scaleFactor;

        canvas.width = scaledWidth;
        canvas.height = scaledHeight;

        // 4. Nearest Neighbor 렌더링 설정 (핵심!)
        // imageSmoothingEnabled를 false로 설정하면 픽셀이 뭉개지지 않음
        ctx.imageSmoothingEnabled = false;

        // 브라우저 호환성을 위한 모든 속성 설정
        (ctx as any).mozImageSmoothingEnabled = false;
        (ctx as any).webkitImageSmoothingEnabled = false;
        (ctx as any).msImageSmoothingEnabled = false;

        // 5. 이미지를 업스케일링된 크기로 그리기
        ctx.drawImage(img, 0, 0, scaledWidth, scaledHeight);

        // 6. Base64 data URL로 변환하여 반환
        const upscaledDataUrl = canvas.toDataURL('image/png');
        resolve(upscaledDataUrl);

      } catch (error) {
        reject(error);
      }
    };

    img.onerror = () => {
      reject(new Error('이미지 로드 실패'));
    };

    // 7. 이미지 로드 시작
    img.src = imageDataUrl;
  });
}

/**
 * 픽셀 아트 이미지를 특정 목표 해상도에 맞춰 업스케일링
 *
 * 원본 크기를 분석하여 적절한 배율을 자동 계산합니다.
 * 예: 64x64 → 256x256 (4배), 128x128 → 512x512 (4배)
 *
 * @param imageDataUrl - Base64 data URL 형식의 원본 이미지
 * @param targetSize - 목표 크기 (기본값: 512px, 긴 쪽 기준)
 * @returns Promise<string> - 업스케일링된 이미지의 Base64 data URL
 */
export async function upscalePixelArtToSize(
  imageDataUrl: string,
  targetSize: number = 512
): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();

    img.onload = async () => {
      try {
        // 원본 이미지의 긴 쪽 기준으로 배율 계산
        const maxDimension = Math.max(img.width, img.height);
        const scaleFactor = Math.ceil(targetSize / maxDimension);

        // 최소 2배, 최대 8배로 제한
        const clampedScaleFactor = Math.max(2, Math.min(8, scaleFactor));

        // Nearest Neighbor 업스케일링 실행
        const upscaled = await upscalePixelArt(imageDataUrl, clampedScaleFactor);
        resolve(upscaled);

      } catch (error) {
        reject(error);
      }
    };

    img.onerror = () => {
      reject(new Error('이미지 로드 실패'));
    };

    img.src = imageDataUrl;
  });
}

/**
 * 이미지가 픽셀 아트인지 간단히 판단하는 휴리스틱 함수
 *
 * 실제 픽셀 아트는 일반적으로:
 * - 저해상도 (512x512 이하)
 * - 제한된 색상 팔레트
 * - 날카로운 픽셀 경계
 *
 * 이 함수는 해상도만 체크하는 간단한 버전입니다.
 *
 * @param imageDataUrl - Base64 data URL 형식의 이미지
 * @returns Promise<boolean> - 픽셀 아트로 추정되면 true
 */
export async function isLikelyPixelArt(imageDataUrl: string): Promise<boolean> {
  return new Promise((resolve) => {
    const img = new Image();

    img.onload = () => {
      // 512x512 이하면 픽셀 아트로 간주
      // (실제로는 색상 팔레트 분석 등이 더 정확함)
      const maxDimension = Math.max(img.width, img.height);
      resolve(maxDimension <= 512);
    };

    img.onerror = () => {
      resolve(false);
    };

    img.src = imageDataUrl;
  });
}
