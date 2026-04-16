import { useState, useEffect, useRef } from 'react';
import { Image as ImageIcon, FolderOpen, HelpCircle, X } from 'lucide-react';
import { open } from '@tauri-apps/plugin-dialog';
import { readFile } from '@tauri-apps/plugin-fs';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { logger } from '../../lib/logger';

interface ImageUploadProps {
  onImageSelect: (imageData: string) => void;
}

export function ImageUpload({ onImageSelect }: ImageUploadProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const onImageSelectRef = useRef(onImageSelect);

  // onImageSelect가 변경될 때마다 ref 업데이트
  useEffect(() => {
    onImageSelectRef.current = onImageSelect;
  }, [onImageSelect]);

  // 호버 상태만 관리 (실제 드롭 처리는 App.tsx에서 전역으로 처리)
  useEffect(() => {
    let unlisten: (() => void) | undefined;

    const setupHoverListener = async () => {
      try {
        const appWindow = getCurrentWindow();

        unlisten = await appWindow.onDragDropEvent((event) => {
          if (event.payload.type === 'enter' || event.payload.type === 'over') {
            setIsDragging(true);
          } else if (event.payload.type === 'drop' || event.payload.type === 'leave') {
            setIsDragging(false);
          }
        });

        logger.debug('✅ [ImageUpload] 호버 리스너 등록 완료');
      } catch (error) {
        logger.error('❌ [ImageUpload] 호버 리스너 등록 실패:', error);
      }
    };

    setupHoverListener();

    return () => {
      if (unlisten) {
        unlisten();
      }
    };
  }, []);

  // 투명 배경을 흰색으로 변환하는 함수
  const convertTransparentToWhite = (dataUrl: string): Promise<string> => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        // Canvas 생성
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');

        if (!ctx) {
          reject(new Error('Canvas context를 가져올 수 없습니다'));
          return;
        }

        // 흰색 배경 그리기
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // 이미지 그리기 (투명 부분은 흰색으로 표시됨)
        ctx.drawImage(img, 0, 0);

        // Canvas를 PNG로 변환
        const convertedDataUrl = canvas.toDataURL('image/png');
        logger.debug('✅ 투명 배경을 흰색으로 변환 완료');
        resolve(convertedDataUrl);
      };
      img.onerror = () => {
        reject(new Error('이미지 로드 실패'));
      };
      img.src = dataUrl;
    });
  };

  // Tauri로 이미지 로드
  const loadTauriImage = async (filePath: string) => {
    try {
      logger.debug('📁 Tauri 파일 읽기:', filePath);
      const fileData = await readFile(filePath);

      // Uint8Array를 base64로 변환
      const base64 = btoa(
        Array.from(new Uint8Array(fileData))
          .map((b) => String.fromCharCode(b))
          .join('')
      );

      // 확장자에서 MIME 타입 추정
      const ext = filePath.split('.').pop()?.toLowerCase();
      const mimeType = ext === 'png' ? 'image/png' :
                      ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' :
                      ext === 'gif' ? 'image/gif' :
                      ext === 'webp' ? 'image/webp' : 'image/png';

      const dataUrl = `data:${mimeType};base64,${base64}`;
      logger.debug('✅ Tauri 파일 변환 완료, 데이터 길이:', dataUrl.length);

      try {
        // 투명 배경을 흰색으로 변환
        const convertedImage = await convertTransparentToWhite(dataUrl);
        onImageSelectRef.current(convertedImage);
      } catch (error) {
        logger.error('❌ 이미지 변환 실패:', error);
        // 변환 실패 시 원본 이미지 사용
        onImageSelectRef.current(dataUrl);
      }
    } catch (error) {
      logger.error('❌ Tauri 파일 읽기 오류:', error);
      alert('파일 읽기 오류: ' + (error as Error).message);
    }
  };

  // Tauri dialog를 사용한 파일 선택
  const handleTauriFileSelect = async () => {
    try {
      logger.debug('🗂️ Tauri dialog 열기');
      const selected = await open({
        multiple: true,
        filters: [
          {
            name: 'Image',
            extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'],
          },
        ],
      });

      if (selected) {
        // 배열인 경우 (다중 선택)
        if (Array.isArray(selected)) {
          logger.debug('📁 선택된 파일 개수:', selected.length);
          for (const filePath of selected) {
            await loadTauriImage(filePath);
          }
        }
        // 단일 파일인 경우
        else if (typeof selected === 'string') {
          logger.debug('📁 선택된 파일:', selected);
          await loadTauriImage(selected);
        }
      }
    } catch (error) {
      logger.error('❌ Tauri 파일 선택 오류:', error);
      alert('파일 선택 오류: ' + (error as Error).message);
    }
  };

  return (
    <div className="flex-1 flex flex-col">
      {/* 상단 도움말 버튼 */}
      <div className="flex justify-end p-4">
        <button
          onClick={() => setShowHelp(true)}
          className="flex items-center gap-2 px-4 py-2 bg-blue-100 hover:bg-blue-200 text-blue-700 rounded-lg transition-colors"
        >
          <HelpCircle size={20} />
          <span className="font-medium">도움말</span>
        </button>
      </div>

      {/* 이미지 업로드 영역 */}
      <div className="flex-1 flex items-center justify-center px-8 pb-8">
        <div
          className={`
            w-full max-w-2xl border-2 border-dashed rounded-xl p-12
            transition-all
            ${
              isDragging
                ? 'border-purple-500 bg-purple-50'
                : 'border-gray-300 hover:border-purple-400 hover:bg-gray-50'
            }
          `}
        >
          <div className="flex flex-col items-center">
            <div
              className={`
              p-6 rounded-full mb-4 transition-colors
              ${isDragging ? 'bg-purple-200' : 'bg-gray-100'}
            `}
            >
              {isDragging ? (
                <ImageIcon size={48} className="text-purple-600" />
              ) : (
                <FolderOpen size={48} className="text-gray-400" />
              )}
            </div>

            <h3 className="text-xl font-bold text-gray-700 mb-2">
              {isDragging ? '이미지를 놓아주세요' : '이미지를 업로드하세요'}
            </h3>

            <p className="text-gray-500 text-center mb-6">
              이미지를 드래그 앤 드롭하거나 아래 버튼으로 선택하세요
              <br />
              <span className="text-sm text-gray-400">PNG, JPG, JPEG, GIF, WEBP 지원</span>
            </p>

            <div className="flex flex-col gap-3 w-full max-w-xs">
              {/* Tauri 파일 선택 버튼 */}
              <button
                onClick={handleTauriFileSelect}
                className="flex items-center justify-center gap-2 bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 text-white px-6 py-3 rounded-lg font-semibold transition-all shadow-lg hover:shadow-xl"
              >
                <FolderOpen size={20} />
                <span>파일 선택</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* 도움말 팝업 */}
      {showHelp && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setShowHelp(false);
            }
          }}
        >
          <div
            className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            {/* 헤더 */}
            <div className="sticky top-0 bg-gradient-to-r from-purple-600 to-blue-600 text-white px-6 py-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <HelpCircle size={24} />
                <h2 className="text-xl font-bold">이미지 등록 가이드</h2>
              </div>
              <button
                onClick={() => setShowHelp(false)}
                className="p-1 hover:bg-white/20 rounded-lg transition-colors"
              >
                <X size={24} />
              </button>
            </div>

            {/* 내용 */}
            <div className="p-6 space-y-6">
              {/* 이미지 개수 제한 */}
              <section>
                <h3 className="text-lg font-bold text-gray-800 mb-3 flex items-center gap-2">
                  <span className="text-purple-600">📊</span>
                  이미지 개수 제한 (최대 14개)
                </h3>
                <div className="bg-purple-50 border border-purple-200 rounded-lg p-4 space-y-2">
                  <p className="text-gray-700">
                    참조 이미지는 <strong className="text-purple-700">최대 14개</strong>까지 등록할 수 있습니다.
                  </p>
                  <p className="text-sm text-gray-600">
                    <strong>제한 이유:</strong> Gemini 3 Pro Vision 모델의 기술적 제약으로, 한 번에 처리할 수 있는 이미지 개수가 제한되어 있습니다.
                    과도한 이미지는 분석 정확도를 떨어뜨리고 응답 시간을 증가시킬 수 있습니다.
                  </p>
                </div>
              </section>

              {/* Gemini 3 Pro Image 모델 특성 */}
              <section>
                <h3 className="text-lg font-bold text-gray-800 mb-3 flex items-center gap-2">
                  <span className="text-blue-600">🤖</span>
                  Gemini 3 Pro Vision 모델 특성
                </h3>
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 space-y-3">
                  <div>
                    <p className="font-semibold text-blue-900 mb-1">✨ 강력한 시각적 이해력</p>
                    <p className="text-sm text-gray-700">
                      이미지의 객체, 스타일, 색상, 분위기를 정확하게 분석하고 이해합니다.
                    </p>
                  </div>
                  <div>
                    <p className="font-semibold text-blue-900 mb-1">🎨 스타일 일관성 유지</p>
                    <p className="text-sm text-gray-700">
                      여러 참조 이미지의 공통 스타일을 파악하여 일관된 결과물을 생성합니다.
                    </p>
                  </div>
                  <div>
                    <p className="font-semibold text-blue-900 mb-1">🔄 멀티모달 처리</p>
                    <p className="text-sm text-gray-700">
                      이미지와 텍스트 프롬프트를 동시에 이해하여 사용자 의도를 정확히 반영합니다.
                    </p>
                  </div>
                </div>
              </section>

              {/* 이미지 등록 시 유의사항 */}
              <section>
                <h3 className="text-lg font-bold text-gray-800 mb-3 flex items-center gap-2">
                  <span className="text-orange-600">⚠️</span>
                  이미지 등록 시 유의사항
                </h3>
                <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
                  <ul className="space-y-2 text-sm text-gray-700">
                    <li className="flex items-start gap-2">
                      <span className="text-orange-600 font-bold">•</span>
                      <span><strong>고해상도 이미지 권장:</strong> 이미지가 너무 작거나 흐릿하면 분석 정확도가 떨어집니다.</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-orange-600 font-bold">•</span>
                      <span><strong>투명 배경 처리:</strong> PNG 투명 배경은 자동으로 흰색으로 변환됩니다.</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-orange-600 font-bold">•</span>
                      <span><strong>유사한 스타일 권장:</strong> 다양한 스타일이 섞이면 일관성이 떨어질 수 있습니다.</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-orange-600 font-bold">•</span>
                      <span><strong>중복 이미지 방지:</strong> 같은 이미지를 여러 번 등록하지 않도록 주의하세요.</span>
                    </li>
                  </ul>
                </div>
              </section>

              {/* 최대 효율을 내기 위한 방법 */}
              <section>
                <h3 className="text-lg font-bold text-gray-800 mb-3 flex items-center gap-2">
                  <span className="text-green-600">💡</span>
                  최대 효율을 내기 위한 방법
                </h3>
                <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                  <ul className="space-y-3 text-sm text-gray-700">
                    <li className="flex items-start gap-2">
                      <span className="text-green-600 font-bold text-lg">1.</span>
                      <div>
                        <p className="font-semibold text-green-900">대표 이미지 선별</p>
                        <p className="text-gray-600">원하는 스타일을 가장 잘 나타내는 3-7개의 이미지를 선택하세요.</p>
                      </div>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-green-600 font-bold text-lg">2.</span>
                      <div>
                        <p className="font-semibold text-green-900">다양한 각도 제공</p>
                        <p className="text-gray-600">캐릭터나 객체의 여러 각도를 보여주면 더 정확한 분석이 가능합니다.</p>
                      </div>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-green-600 font-bold text-lg">3.</span>
                      <div>
                        <p className="font-semibold text-green-900">명확한 주제</p>
                        <p className="text-gray-600">이미지의 주제가 명확할수록 AI가 핵심 요소를 더 잘 파악합니다.</p>
                      </div>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-green-600 font-bold text-lg">4.</span>
                      <div>
                        <p className="font-semibold text-green-900">세션 타입 활용</p>
                        <p className="text-gray-600">캐릭터, 배경, 아이콘, 픽셀아트 등 목적에 맞는 세션 타입을 선택하세요.</p>
                      </div>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-green-600 font-bold text-lg">5.</span>
                      <div>
                        <p className="font-semibold text-green-900">사용자 맞춤 프롬프트</p>
                        <p className="text-gray-600">이미지 분석 후 추가 프롬프트로 세부 사항을 조정할 수 있습니다.</p>
                      </div>
                    </li>
                  </ul>
                </div>
              </section>

              {/* 지원 형식 */}
              <section>
                <h3 className="text-lg font-bold text-gray-800 mb-3 flex items-center gap-2">
                  <span className="text-gray-600">📁</span>
                  지원 파일 형식
                </h3>
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                  <p className="text-sm text-gray-700">
                    PNG, JPG, JPEG, GIF, WEBP 형식의 이미지 파일을 지원합니다.
                  </p>
                </div>
              </section>
            </div>

            {/* 푸터 */}
            <div className="sticky bottom-0 bg-gray-50 px-6 py-4 border-t border-gray-200">
              <button
                onClick={() => setShowHelp(false)}
                className="w-full px-4 py-3 bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 text-white rounded-lg font-semibold transition-all shadow-lg"
              >
                확인
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
