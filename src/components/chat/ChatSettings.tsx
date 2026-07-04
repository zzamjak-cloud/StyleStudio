import type { ChatGenerationSettings } from '../../types/chat';
import { ChevronDown } from 'lucide-react';
import { getAvailableImageModels, getImageModelDefinition, type ImageGenerationModel } from '../../hooks/api/imageModels';

interface ChatSettingsProps {
  settings: ChatGenerationSettings;
  hasOpenAIApiKey: boolean;
  onSettingsChange: (settings: Partial<ChatGenerationSettings>) => void;
}

/** 상단 설정 바 (화면비, 모델 선택) */
export function ChatSettings({ settings, hasOpenAIApiKey, onSettingsChange }: ChatSettingsProps) {
  const models = getAvailableImageModels(hasOpenAIApiKey);
  const aspectRatios = getImageModelDefinition(settings.imageModel).supports.aspectRatios as ChatGenerationSettings['aspectRatio'][];
  return (
    <div className="flex items-center justify-between px-4 py-2 border-b border-gray-200 bg-white gap-4">
      {/* 왼쪽: 화면비 선택 */}
      <div className="flex items-center gap-1.5 min-w-0 flex-1">
        <span className="text-xs text-gray-500 mr-1">비율</span>
        {aspectRatios.map((ratio) => {
          const isSelected = settings.aspectRatio === ratio;
          return (
            <button
              key={ratio}
              onClick={() => onSettingsChange({ aspectRatio: ratio })}
              className={`min-w-0 flex-1 px-1.5 py-0.5 text-[11px] rounded-full border transition-colors ${
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
        <div className="relative">
          <select
            value={settings.imageModel}
            onChange={(e) => onSettingsChange({ imageModel: e.target.value as ImageGenerationModel })}
            className="w-44 appearance-none rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1 pr-7 text-xs text-gray-700 focus:border-purple-400 focus:outline-none focus:ring-2 focus:ring-purple-100"
          >
            {models.map((model) => (
              <option key={model.id} value={model.id}>
                {model.label}
              </option>
            ))}
          </select>
          <ChevronDown
            size={14}
            className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-gray-400"
          />
        </div>
      </div>
    </div>
  );
}
