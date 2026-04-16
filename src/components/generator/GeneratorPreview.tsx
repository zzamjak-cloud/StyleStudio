import { Image as ImageIcon, Download } from 'lucide-react';

interface GeneratorPreviewProps {
  isGenerating: boolean;
  progressMessage: string;
  generatedImage: string | null;
  zoomLevel: 'fit' | 'actual' | number;
  onManualSave: () => void;
}

export function GeneratorPreview({
  isGenerating,
  progressMessage,
  generatedImage,
  zoomLevel,
  onManualSave,
}: GeneratorPreviewProps) {
  return (
    <div className={`flex-1 p-8 ${zoomLevel === 'fit' && generatedImage ? 'overflow-hidden' : 'overflow-y-auto'}`}>
      <div className={`flex items-center justify-center ${zoomLevel === 'fit' && generatedImage ? 'h-full' : 'min-h-full'}`}>
        {isGenerating ? (
          <div className="flex flex-col items-center">
            <div className="animate-spin rounded-full h-16 w-16 border-4 border-purple-500 border-t-transparent mb-4"></div>
            <p className="text-gray-600 font-semibold">{progressMessage}</p>
          </div>
        ) : generatedImage ? (
          <div className={`max-w-5xl w-full ${zoomLevel === 'fit' ? 'h-full flex flex-col' : ''}`}>
            {/* 이미지 표시 영역 */}
            <div
              className={`relative bg-white rounded-xl shadow-2xl ${
                zoomLevel === 'fit' ? '' : 'p-6 overflow-auto'
              }`}
              style={{
                ...(zoomLevel === 'fit' ? {
                  height: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '1.5rem',
                } : {
                  maxHeight: '70vh',
                }),
              }}
            >
              {/* 다운로드 버튼 (좌측 상단 오버레이) */}
              <button
                onClick={onManualSave}
                className="absolute top-4 left-4 z-10 p-3 bg-white/90 hover:bg-white border border-gray-200 rounded-lg shadow-lg transition-all hover:shadow-xl group"
                title="이미지 저장"
              >
                <Download size={20} className="text-gray-700 group-hover:text-purple-600 transition-colors" />
              </button>

              {zoomLevel === 'fit' ? (
                <img
                  src={generatedImage}
                  alt="Generated"
                  className="rounded-lg"
                  style={{
                    maxWidth: '100%',
                    maxHeight: '100%',
                    width: 'auto',
                    height: 'auto',
                    objectFit: 'contain',
                  }}
                />
              ) : (
                <div className="flex items-center justify-center">
                  <img
                    src={generatedImage}
                    alt="Generated"
                    className="rounded-lg"
                    style={{
                      ...(zoomLevel === 'actual' ? {
                        width: 'auto',
                        height: 'auto',
                      } : {
                        width: `${zoomLevel}%`,
                        height: 'auto',
                      }),
                    }}
                  />
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="text-center text-gray-400">
            <ImageIcon size={64} className="mx-auto mb-4 opacity-30" />
            <p className="text-lg font-semibold">이미지를 생성해보세요</p>
            <p className="text-sm mt-2">왼쪽 설정을 조정하고 "이미지 생성" 버튼을 클릭하세요</p>
          </div>
        )}
      </div>
    </div>
  );
}
