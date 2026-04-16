/**
 * 파일 처리 유틸리티 함수들
 */

/**
 * 파일을 Base64 Data URL로 변환
 * @param file - 변환할 파일
 * @returns Base64 Data URL Promise
 */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = (event) => {
      const result = event.target?.result as string;
      if (result) {
        resolve(result);
      } else {
        reject(new Error('파일 읽기 실패: 결과가 없습니다'));
      }
    };

    reader.onerror = () => {
      reject(new Error('파일 읽기 중 오류가 발생했습니다'));
    };

    reader.readAsDataURL(file);
  });
}

/**
 * 여러 파일을 Base64 Data URL 배열로 변환
 * @param files - 변환할 파일 배열
 * @returns Base64 Data URL 배열 Promise
 */
export async function filesToBase64Array(files: File[]): Promise<string[]> {
  const promises = files.map(file => fileToBase64(file));
  return Promise.all(promises);
}

/**
 * Canvas를 Base64 PNG Data URL로 변환
 * @param canvas - 변환할 Canvas 엘리먼트
 * @param quality - 이미지 품질 (0.0 ~ 1.0, 기본값: 0.92)
 * @returns Base64 PNG Data URL
 */
export function canvasToBase64(canvas: HTMLCanvasElement, quality: number = 0.92): string {
  return canvas.toDataURL('image/png', quality);
}

/**
 * 투명 배경을 흰색 배경으로 변환하여 Base64 PNG로 반환
 * @param dataUrl - 원본 이미지 Data URL
 * @returns 흰색 배경으로 변환된 Base64 PNG Data URL Promise
 */
export function convertTransparentToWhite(dataUrl: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();

    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');

      if (!ctx) {
        reject(new Error('Canvas 2D 컨텍스트를 가져올 수 없습니다'));
        return;
      }

      // 흰색 배경 그리기
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // 이미지 그리기
      ctx.drawImage(img, 0, 0);

      // Canvas를 PNG로 변환
      const convertedDataUrl = canvasToBase64(canvas);
      resolve(convertedDataUrl);
    };

    img.onerror = () => {
      reject(new Error('이미지 로드 중 오류가 발생했습니다'));
    };

    img.src = dataUrl;
  });
}

/**
 * Base64 Data URL에서 MIME 타입 추출
 * @param dataUrl - Base64 Data URL
 * @returns MIME 타입 (예: "image/png")
 */
export function getMimeTypeFromDataUrl(dataUrl: string): string | null {
  const match = dataUrl.match(/^data:([^;]+);/);
  return match ? match[1] : null;
}

/**
 * Base64 Data URL의 파일 크기 계산 (바이트)
 * @param dataUrl - Base64 Data URL
 * @returns 파일 크기 (바이트)
 */
export function getDataUrlSize(dataUrl: string): number {
  // Base64 문자열 추출 (data:image/png;base64, 이후)
  const base64 = dataUrl.split(',')[1] || '';

  // Base64 문자열 길이를 바이트로 변환
  // Base64는 3바이트를 4문자로 인코딩하므로 (length * 3 / 4)
  const padding = (base64.match(/=/g) || []).length;
  return (base64.length * 3 / 4) - padding;
}

/**
 * 파일 크기를 사람이 읽기 쉬운 형식으로 변환
 * @param bytes - 바이트 크기
 * @returns 포맷된 문자열 (예: "1.5 MB")
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes';

  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Base64 Data URL을 Blob으로 변환
 * @param dataUrl - Base64 Data URL
 * @returns Blob 객체
 */
export function dataUrlToBlob(dataUrl: string): Blob {
  const arr = dataUrl.split(',');
  const mimeMatch = arr[0].match(/:(.*?);/);
  const mime = mimeMatch ? mimeMatch[1] : 'image/png';
  const bstr = atob(arr[1]);
  let n = bstr.length;
  const u8arr = new Uint8Array(n);

  while (n--) {
    u8arr[n] = bstr.charCodeAt(n);
  }

  return new Blob([u8arr], { type: mime });
}

/**
 * Base64 Data URL을 Uint8Array로 변환
 * @param dataUrl - Base64 Data URL
 * @returns Uint8Array
 */
export function dataUrlToUint8Array(dataUrl: string): Uint8Array {
  const arr = dataUrl.split(',');
  const bstr = atob(arr[1]);
  const n = bstr.length;
  const u8arr = new Uint8Array(n);

  for (let i = 0; i < n; i++) {
    u8arr[i] = bstr.charCodeAt(i);
  }

  return u8arr;
}
