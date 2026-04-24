import { memo } from 'react';
import { Award } from 'lucide-react';
import { LogoSpecificAnalysis } from '../../types/analysis';
import { AnalysisCard } from './AnalysisCard';

interface LogoCardProps {
  logoAnalysis: LogoSpecificAnalysis;
  onUpdate?: (logoAnalysis: LogoSpecificAnalysis) => void;
}

export const LogoCard = memo(function LogoCard({ logoAnalysis, onUpdate }: LogoCardProps) {
  const fields: Array<{ key: keyof LogoSpecificAnalysis; label: string; icon?: string }> = [
    { key: 'typography_style', label: '타이포그래피 스타일', icon: '✍️' },
    { key: 'text_warping', label: '텍스트 변형', icon: '🌊' },
    { key: 'text_weight', label: '폰트 두께', icon: '⚖️' },
    { key: 'edge_treatment', label: '모서리 처리', icon: '📐' },
    { key: 'material_type', label: '재질 타입 (가장 중요!)', icon: '💎' },
    { key: 'rendering_style', label: '렌더링 스타일', icon: '🎬' },
    { key: 'surface_quality', label: '표면 품질', icon: '✨' },
    { key: 'outline_style', label: '외곽선 스타일', icon: '🖌️' },
    { key: 'drop_shadow', label: '그림자', icon: '🌑' },
    { key: 'inner_effects', label: '내부 효과', icon: '💫' },
    { key: 'decorative_elements', label: '장식 요소', icon: '🎀' },
    { key: 'color_vibrancy', label: '색상 채도', icon: '🌈' },
    { key: 'color_count', label: '색상 개수', icon: '🎨' },
    { key: 'gradient_usage', label: '그라데이션 사용', icon: '🌅' },
    { key: 'genre_hint', label: '장르 힌트', icon: '🎮' },
  ];

  return (
    <AnalysisCard<LogoSpecificAnalysis>
      title="로고 특화 분석"
      icon={Award}
      iconColor="text-red-600"
      borderColor="border-red-200"
      bgColor="bg-red-100"
      hoverColor="hover:text-red-600 hover:bg-red-50"
      focusColor="border-red-500 focus:ring-red-500"
      data={logoAnalysis}
      fields={fields}
      onUpdate={onUpdate}
    />
  );
});
