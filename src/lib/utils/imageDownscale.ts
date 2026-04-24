/**
 * Base64 data URL 이미지를 캔버스로 다운스케일·재인코딩한다.
 *
 * 큰 참조/첨부 이미지를 그대로 IndexedDB와 메모리에 보관하면 디스크·메모리·디코딩
 * 비용이 모두 누적된다. 사용자 업로드 즉시 max dimension 기준으로 축소하고
 * JPEG 품질을 낮춰 저장하면, AI 분석 품질에는 영향이 거의 없으면서 앱 전체
 * 반응성이 크게 개선된다.
 *
 * - 원본이 maxDim 이하이면 변환 없이 원본을 그대로 반환 (비용 0)
 * - 원본이 PNG이면 PNG 유지 (투명도 보존)
 * - 그 외에는 JPEG로 재인코딩 (기본 0.85 품질)
 */
export async function downscaleImage(
  dataUrl: string,
  maxDim: number = 1280,
  quality: number = 0.85
): Promise<string> {
  if (!dataUrl || !dataUrl.startsWith('data:')) {
    return dataUrl;
  }

  return new Promise<string>((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const { width, height } = img;
        if (width <= maxDim && height <= maxDim) {
          resolve(dataUrl);
          return;
        }
        const scale = maxDim / Math.max(width, height);
        const targetW = Math.max(1, Math.round(width * scale));
        const targetH = Math.max(1, Math.round(height * scale));

        const canvas = document.createElement('canvas');
        canvas.width = targetW;
        canvas.height = targetH;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(dataUrl);
          return;
        }
        ctx.drawImage(img, 0, 0, targetW, targetH);

        const isPng = dataUrl.startsWith('data:image/png');
        const out = isPng
          ? canvas.toDataURL('image/png')
          : canvas.toDataURL('image/jpeg', quality);
        resolve(out);
      } catch {
        resolve(dataUrl);
      }
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}
