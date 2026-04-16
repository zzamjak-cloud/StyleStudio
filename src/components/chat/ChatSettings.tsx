import type { ChatGenerationSettings } from '../../types/chat';
import { IMAGE_MODELS, type ImageGenerationModel } from '../../hooks/api/useGeminiImageGenerator';

// 지원되는 화면비 목록
const ASPECT_RATIOS: ChatGenerationSettings['aspectRatio'][] = ['1:1', '16:9', '9:16', '4:3', '3:4'];

interface ChatSettingsProps {
  settings: ChatGenerationSettings;
  onSettingsChange: (settings: Partial<ChatGenerationSettings>) => void;
}

/** 상단 설정 바 (화면비, 모델 선택) */
export function ChatSettings({ settings, onSettingsChange }: ChatSettingsProps) {
  return (
    <div className="flex items-center justify-between px-4 py-2 border-b border-gray-200 bg-white gap-4">
      {/* 왼쪽: 화면비 선택 */}
      <div className="flex items-center gap-1.5">
        <span className="text-xs text-gray-500 mr-1">비율</span>
        {ASPECT_RATIOS.map((ratio) => {
          const isSelected = settings.aspectRatio === ratio;
          return (
            <button
              key={ratio}
              onClick={() => onSettingsChange({ aspectRatio: ratio })}
              className={`px-2 py-0.5 text-xs rounded-full border transition-colors ${
                isSelected
                  ? 'bg-purple-100 text-purple-700 border-purple-300'
                  : 'bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100'
              }`}
            >
              {ratio}
            </button>
          );
        })}
      </div>

      {/* 오른쪽: 모델 선택 */}
      <div className="flex items-center gap-1.5">
        <span className="text-xs text-gray-500 mr-1">모델</span>
        {IMAGE_MODELS.map((model) => {
          const isSelected = settings.imageModel === model.id;
          return (
            <button
              key={model.id}
              onClick={() => onSettingsChange({ imageModel: model.id as ImageGenerationModel })}
              className={`px-2 py-0.5 text-xs rounded-full border transition-colors ${
                isSelected
                  ? 'bg-purple-100 text-purple-700 border-purple-300'
                  : 'bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100'
              }`}
            >
              {model.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
