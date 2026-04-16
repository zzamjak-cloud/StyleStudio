import { useState } from 'react';
import { Sparkles, Save, Plus, Trash2, Wand2, HelpCircle, X } from 'lucide-react';
import { ImageAnalysisResult } from '../../types/analysis';
import { fileToBase64 } from '../../utils/fileUtils';
import { StyleCard } from './StyleCard';
import { CharacterCard } from './CharacterCard';
import { CompositionCard } from './CompositionCard';
import { NegativePromptCard } from './NegativePromptCard';
import { UnifiedPromptCard } from './UnifiedPromptCard';
import { UICard } from './UICard';
import { LogoCard } from './LogoCard';
import { Session } from '../../types/session';

import { StyleAnalysis, CharacterAnalysis, CompositionAnalysis, UISpecificAnalysis, LogoSpecificAnalysis } from '../../types/analysis';

interface AnalysisPanelProps {
  images: string[];
  isAnalyzing: boolean;
  analysisResult: ImageAnalysisResult | null;
  onAnalyze: () => void;
  onSaveSession?: () => void;
  onAddImage?: (imageData: string) => void;
  onRemoveImage?: (index: number) => void;
  onGenerateImage?: () => void;
  currentSession?: Session | null;
  onStyleUpdate?: (style: StyleAnalysis) => void;
  onCharacterUpdate?: (character: CharacterAnalysis) => void;
  onCompositionUpdate?: (composition: CompositionAnalysis) => void;
  onNegativePromptUpdate?: (negativePrompt: string) => void;
  onUIAnalysisUpdate?: (uiAnalysis: UISpecificAnalysis) => void;
  onLogoAnalysisUpdate?: (logoAnalysis: LogoSpecificAnalysis) => void;
}

export function AnalysisPanel({
  images,
  isAnalyzing,
  analysisResult,
  onAnalyze,
  onSaveSession,
  onAddImage,
  onRemoveImage,
  onGenerateImage,
  currentSession,
  onStyleUpdate,
  onCharacterUpdate,
  onCompositionUpdate,
  onNegativePromptUpdate,
  onUIAnalysisUpdate,
  onLogoAnalysisUpdate,
}: AnalysisPanelProps) {
  const [deleteImageConfirm, setDeleteImageConfirm] = useState<number | null>(null);
  const [showHelp, setShowHelp] = useState(false);

  // 배경 타입 체크
  const isBackgroundType = currentSession?.type === 'BACKGROUND' || currentSession?.type === 'PIXELART_BACKGROUND';
  // UI 타입 체크
  const isUIType = currentSession?.type === 'UI';
  // LOGO 타입 체크
  const isLogoType = currentSession?.type === 'LOGO';

  if (images.length === 0) {
    return null;
  }

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* 왼쪽: 이미지 미리보기 그리드 */}
      <div className="flex-1 flex flex-col p-8 bg-gray-50 overflow-y-auto">
        <div className="max-w-4xl mx-auto w-full">
          {/* 참조 이미지 헤더 */}
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-lg font-bold text-gray-800">참조 이미지</h3>
              <p className="text-sm text-gray-500">{images.length}/14</p>
            </div>
            {/* 도움말 버튼 */}
            <button
              onClick={() => setShowHelp(true)}
              className="flex items-center gap-2 px-4 py-2 bg-blue-100 hover:bg-blue-200 text-blue-700 rounded-lg transition-colors"
            >
              <HelpCircle size={20} />
              <span className="font-medium">도움말</span>
            </button>
          </div>

          {/* 이미지 그리드 */}
          <div className="grid grid-cols-4 gap-4 mb-4">
            {images.map((image, index) => (
              <div key={index} className="relative group">
                <img
                  src={image}
                  alt={`Reference ${index + 1}`}
                  className="w-full h-auto rounded-xl shadow-lg"
                />

                {/* 삭제 버튼 */}
                {onRemoveImage && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setDeleteImageConfirm(index);
                    }}
                    className="absolute top-2 right-2 p-2 bg-red-500 hover:bg-red-600 text-white rounded-lg opacity-0 group-hover:opacity-100 transition-opacity shadow-lg"
                    title="이미지 삭제"
                  >
                    <Trash2 size={18} />
                  </button>
                )}

                {/* 이미지 번호 */}
                <div className="absolute bottom-2 left-2 px-2 py-1 bg-black/50 text-white text-xs rounded">
                  #{index + 1}
                </div>
              </div>
            ))}
          </div>

          {/* 이미지 추가 버튼 - 세션이 있을 때만 표시 */}
          {onAddImage && currentSession && (
            <div className="mb-4">
              <label className="cursor-pointer">
                <div className="border-2 border-dashed border-gray-300 hover:border-purple-500 rounded-xl p-8 flex flex-col items-center justify-center transition-all hover:bg-gray-100">
                  <Plus size={48} className="text-gray-400 mb-2" />
                  <p className="text-gray-600 font-semibold">이미지 추가하기</p>
                  <p className="text-sm text-gray-500">스타일 분석을 강화할 이미지를 추가하세요</p>
                </div>
                <input
                  type="file"
                  accept="image/*"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      try {
                        const dataUrl = await fileToBase64(file);
                        onAddImage(dataUrl);
                      } catch (error) {
                        console.error('파일 읽기 실패:', error);
                      }
                    }
                  }}
                  className="hidden"
                />
              </label>
            </div>
          )}
        </div>
      </div>

      {/* 오른쪽: 분석 패널 */}
      <div className="w-[500px] bg-white border-l border-gray-200 p-6 flex flex-col overflow-y-auto">
        {/* 분석 전 상태 */}
        {!analysisResult && !isAnalyzing && (
          <>
            <p className="text-gray-600 mb-6">
              AI가 이미지의 스타일, 캐릭터, 구도를 분석합니다.
            </p>

            <button
              onClick={onAnalyze}
              className="flex items-center justify-center gap-2 bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 text-white px-6 py-3 rounded-lg font-semibold transition-all shadow-lg hover:shadow-xl"
            >
              <Sparkles size={20} />
              <span>이미지 분석 시작</span>
            </button>
          </>
        )}

        {/* 분석 중 상태 */}
        {isAnalyzing && (
          <div className="flex-1 flex flex-col items-center justify-center">
            <div className="animate-spin rounded-full h-12 w-12 border-4 border-purple-500 border-t-transparent mb-4"></div>
            <p className="text-gray-600 font-semibold">Gemini가 분석 중...</p>
            <p className="text-sm text-gray-500 mt-2">스타일, 캐릭터, 구도 정보 추출 중</p>
          </div>
        )}

        {/* 분석 완료 상태 */}
        {analysisResult && !isAnalyzing && (
          <div className="space-y-4">
            {/* 액션 버튼 (상단) - 아이콘만 한 라인에 3개 */}
            <div className="flex gap-2 pb-4 border-b border-gray-200">
              {/* 분석 강화 버튼 */}
              <button
                onClick={onAnalyze}
                className="flex-1 flex items-center justify-center p-3 bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 text-white rounded-lg transition-all shadow-lg hover:shadow-xl"
                title={currentSession ? '분석 강화' : '다시 분석'}
              >
                <Sparkles size={20} />
              </button>

              {/* 세션 저장 버튼 */}
              {onSaveSession && (
                <button
                  onClick={onSaveSession}
                  className="flex-1 flex items-center justify-center p-3 bg-gradient-to-r from-green-600 to-teal-600 hover:from-green-700 hover:to-teal-700 text-white rounded-lg transition-all shadow-lg hover:shadow-xl"
                  title="세션 저장"
                >
                  <Save size={20} />
                </button>
              )}

              {/* 이미지 생성 버튼 */}
              {onGenerateImage && (
                <button
                  onClick={onGenerateImage}
                  className="flex-1 flex items-center justify-center p-3 bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 text-white rounded-lg transition-all shadow-lg hover:shadow-xl"
                  title="이미지 생성하기"
                >
                  <Wand2 size={20} />
                </button>
              )}
            </div>

            {/* 1. 스타일 카드 */}
            <StyleCard
              style={analysisResult.style}
              onUpdate={onStyleUpdate}
            />

            {/* 2. UI 디자인 카드 (UI 타입에서만) */}
            {isUIType && analysisResult.ui_specific && (
              <UICard
                uiAnalysis={analysisResult.ui_specific}
                onUpdate={onUIAnalysisUpdate}
              />
            )}

            {/* 3. 로고 특화 카드 (LOGO 타입에서만) */}
            {isLogoType && analysisResult.logo_specific && (
              <LogoCard
                logoAnalysis={analysisResult.logo_specific}
                onUpdate={onLogoAnalysisUpdate}
              />
            )}

            {/* 4. 캐릭터 카드 (배경, UI, LOGO 타입에서는 숨김) */}
            {!isBackgroundType && !isUIType && !isLogoType && (
              <CharacterCard
                character={analysisResult.character}
                onUpdate={onCharacterUpdate}
              />
            )}

            {/* 5. 구도 카드 */}
            <CompositionCard
              composition={analysisResult.composition}
              onUpdate={onCompositionUpdate}
            />

            {/* 6. 부정 프롬프트 카드 */}
            <NegativePromptCard
              negativePrompt={analysisResult.negative_prompt}
              onUpdate={onNegativePromptUpdate}
            />

            {/* 7. 통합 프롬프트 카드 (최하단) */}
            <UnifiedPromptCard
              analysis={analysisResult}
            />
          </div>
        )}
      </div>

      {/* 이미지 삭제 확인 다이얼로그 */}
      {deleteImageConfirm !== null && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setDeleteImageConfirm(null);
            }
          }}
        >
          <div
            className="bg-white border border-gray-200 rounded-lg shadow-xl max-w-sm w-full p-6 mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold mb-2 text-gray-800">이미지 삭제 확인</h3>
            <p className="text-gray-600 mb-6">
              참조 이미지 #{deleteImageConfirm + 1}을(를) 삭제하시겠습니까?
              <br />
              이미지를 삭제하면 분석 내용도 함께 사라질 수 있습니다.
              <br />
              이 작업은 되돌릴 수 없습니다.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setDeleteImageConfirm(null)}
                className="px-4 py-2 rounded-lg bg-gray-200 hover:bg-gray-300 transition-colors font-medium text-gray-700"
              >
                취소
              </button>
              <button
                onClick={() => {
                  if (onRemoveImage) {
                    onRemoveImage(deleteImageConfirm);
                  }
                  setDeleteImageConfirm(null);
                }}
                className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 transition-colors font-medium text-white"
              >
                삭제
              </button>
            </div>
          </div>
        </div>
      )}

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
