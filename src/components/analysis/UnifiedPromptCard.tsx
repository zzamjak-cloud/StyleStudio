import { useState } from 'react';
import { Copy, Check, Sparkles } from 'lucide-react';
import { ImageAnalysisResult } from '../../types/analysis';
import { buildUnifiedPrompt } from '../../lib/promptBuilder';
import { logger } from '../../lib/logger';

interface UnifiedPromptCardProps {
  analysis: ImageAnalysisResult;
}

export function UnifiedPromptCard({
  analysis,
}: UnifiedPromptCardProps) {
  const [copiedPositive, setCopiedPositive] = useState(false);
  const [copiedNegative, setCopiedNegative] = useState(false);

  const { positivePrompt, negativePrompt } = buildUnifiedPrompt(analysis);

  const handleCopy = async (text: string, type: 'positive' | 'negative') => {
    try {
      await navigator.clipboard.writeText(text);
      if (type === 'positive') {
        setCopiedPositive(true);
        setTimeout(() => setCopiedPositive(false), 2000);
      } else {
        setCopiedNegative(true);
        setTimeout(() => setCopiedNegative(false), 2000);
      }
    } catch (error) {
      logger.error('복사 실패:', error);
      alert('클립보드 복사 실패');
    }
  };

  return (
    <div className="bg-gradient-to-br from-purple-50 to-blue-50 rounded-xl shadow-lg p-6 border-2 border-purple-300">
      {/* 헤더 */}
      <div className="flex items-center gap-3 mb-4">
        <div className="p-2 bg-purple-600 rounded-lg">
          <Sparkles size={24} className="text-white" />
        </div>
        <div>
          <h3 className="text-xl font-bold text-gray-800">통합 프롬프트</h3>
          <p className="text-xs text-gray-600">모든 분석 카드의 정보를 통합한 프롬프트</p>
        </div>
      </div>

      {/* Positive Prompt */}
      <div className="mb-4">
        <div className="flex items-center justify-between mb-2">
          <label className="text-sm font-semibold text-gray-700">✅ Positive Prompt</label>
          <button
            onClick={() => handleCopy(positivePrompt, 'positive')}
            className="p-2 text-green-600 hover:bg-green-100 hover:text-green-700 rounded-lg transition-all"
            title="복사"
          >
            {copiedPositive ? <Check size={18} /> : <Copy size={18} />}
          </button>
        </div>
        <div className="bg-white rounded-lg p-4 border border-gray-200 max-h-40 overflow-y-auto">
          <p className="text-sm text-gray-800 whitespace-pre-wrap break-words leading-relaxed">
            {positivePrompt}
          </p>
        </div>
      </div>

      {/* Negative Prompt */}
      <div className="mb-4">
        <div className="flex items-center justify-between mb-2">
          <label className="text-sm font-semibold text-gray-700">❌ Negative Prompt</label>
          <button
            onClick={() => handleCopy(negativePrompt, 'negative')}
            className="p-2 text-red-600 hover:bg-red-100 hover:text-red-700 rounded-lg transition-all"
            title="복사"
          >
            {copiedNegative ? <Check size={18} /> : <Copy size={18} />}
          </button>
        </div>
        <div className="bg-white rounded-lg p-4 border border-gray-200 max-h-40 overflow-y-auto">
          <p className="text-sm text-gray-800 whitespace-pre-wrap break-words leading-relaxed">
            {negativePrompt}
          </p>
        </div>
      </div>

      {/* 안내 메시지 */}
      <div className="mt-2 p-3 bg-blue-50 border border-blue-200 rounded-lg">
        <p className="text-xs text-blue-800">
          <strong>💡 사용법:</strong> 통합 프롬프트는 모든 분석 카드의 정보를 모아서 표시합니다.
          <br />각 분석 카드를 수정하면 통합 프롬프트가 자동으로 갱신됩니다.
          <br />복사 버튼을 클릭하면 영어 원본이 복사됩니다.
        </p>
      </div>
    </div>
  );
}
