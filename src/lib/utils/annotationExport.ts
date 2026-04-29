// Konva Stage / Layer로부터 합성 이미지와 마스크 PNG를 추출하는 유틸

export interface ExportOptions {
  pixelRatio?: number; // 기본 1, 고해상도 추출 시 2
  mimeType?: string;   // 기본 image/png
  quality?: number;    // JPEG 품질 (0~1). PNG는 무시
}

interface KonvaNode {
  toDataURL: (config?: { mimeType?: string; pixelRatio?: number; quality?: number }) => string;
}

/** Stage 또는 Layer에서 dataURL 추출. JPEG로 추출 시 quality 적용 가능 */
export function exportNodeToDataUrl(node: KonvaNode | null, options: ExportOptions = {}): string {
  if (!node) {
    throw new Error('Konva 노드가 비어있습니다');
  }
  return node.toDataURL({
    mimeType: options.mimeType ?? 'image/png',
    pixelRatio: options.pixelRatio ?? 1,
    quality: options.quality,
  });
}

/** 마스크 레이어 dataURL을 OpenAI edits 사양(편집할 영역=흰색, 보존=검정)으로 정규화.
 *  Konva에서 흰색으로 그린 stroke가 투명 배경 위에 있을 경우 흑/백 binary로 변환한다.
 */
export async function normalizeMaskToOpenAI(maskDataUrl: string): Promise<string> {
  const img = await loadImage(maskDataUrl);
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth || img.width;
  canvas.height = img.naturalHeight || img.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D 컨텍스트 생성 실패');

  // 검정 배경
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  // 마스크 stroke를 흰색으로 합성
  ctx.drawImage(img, 0, 0);

  // alpha 기반으로 binary 마스크 생성
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const px = data.data;
  for (let i = 0; i < px.length; i += 4) {
    const alpha = px[i + 3];
    if (alpha > 16) {
      px[i] = 255; px[i + 1] = 255; px[i + 2] = 255; px[i + 3] = 255;
    } else {
      px[i] = 0; px[i + 1] = 0; px[i + 2] = 0; px[i + 3] = 255;
    }
  }
  ctx.putImageData(data, 0, 0);
  return canvas.toDataURL('image/png');
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('마스크 이미지 디코딩 실패'));
    image.src = src;
  });
}
