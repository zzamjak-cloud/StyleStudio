import { Camera } from 'lucide-react';
import { CompositionAnalysis } from '../../types/analysis';
import { AnalysisCard } from './AnalysisCard';

interface CompositionCardProps {
  composition: CompositionAnalysis;
  onUpdate?: (composition: CompositionAnalysis) => void;
}

export function CompositionCard({ composition, onUpdate }: CompositionCardProps) {
  const fields: Array<{ key: keyof CompositionAnalysis; label: string; icon?: string }> = [
    { key: 'pose', label: '포즈', icon: '🧍' },
    { key: 'angle', label: '앵글', icon: '📐' },
    { key: 'background', label: '배경', icon: '🏞️' },
    { key: 'depth_of_field', label: '심도', icon: '🔍' },
  ];

  return (
    <AnalysisCard<CompositionAnalysis>
      title="구도 분석"
      icon={Camera}
      iconColor="text-green-600"
      borderColor="border-green-200"
      bgColor="bg-green-100"
      hoverColor="hover:text-green-600 hover:bg-green-50"
      focusColor="border-green-500 focus:ring-green-500"
      data={composition}
      fields={fields}
      onUpdate={onUpdate}
    />
  );
}
