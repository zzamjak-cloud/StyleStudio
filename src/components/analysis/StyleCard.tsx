import { memo } from 'react';
import { Palette } from 'lucide-react';
import { StyleAnalysis } from '../../types/analysis';
import { AnalysisCard } from './AnalysisCard';

interface StyleCardProps {
  style: StyleAnalysis;
  onUpdate?: (style: StyleAnalysis) => void;
}

export const StyleCard = memo(function StyleCard({ style, onUpdate }: StyleCardProps) {
  const fields: Array<{ key: keyof StyleAnalysis; label: string; icon?: string }> = [
    { key: 'art_style', label: '화풍', icon: '🎨' },
    { key: 'technique', label: '기법', icon: '🖌️' },
    { key: 'color_palette', label: '색상', icon: '🎨' },
    { key: 'lighting', label: '조명', icon: '💡' },
    { key: 'mood', label: '분위기', icon: '✨' },
  ];

  return (
    <AnalysisCard<StyleAnalysis>
      title="스타일 분석"
      icon={Palette}
      iconColor="text-purple-600"
      borderColor="border-purple-200"
      bgColor="bg-purple-100"
      hoverColor="hover:text-purple-600 hover:bg-purple-50"
      focusColor="border-purple-500 focus:ring-purple-500"
      data={style}
      fields={fields}
      onUpdate={onUpdate}
    />
  );
});
