import { memo } from 'react';
import { LayoutGrid } from 'lucide-react';
import { TilemapSpecificAnalysis } from '../../types/analysis';
import { AnalysisCard } from './AnalysisCard';

interface TilemapCardProps {
  tilemapAnalysis: TilemapSpecificAnalysis;
  onUpdate?: (tilemapAnalysis: TilemapSpecificAnalysis) => void;
}

/** 타일맵 세션 전용 분석 카드 — 손맵 채색 특성(tilemap_specific) 편집 */
export const TilemapCard = memo(function TilemapCard({ tilemapAnalysis, onUpdate }: TilemapCardProps) {
  const fields: Array<{ key: keyof TilemapSpecificAnalysis; label: string; icon?: string }> = [
    { key: 'material_type', label: '재질', icon: '🧱' },
    { key: 'brush_style', label: '붓터치 스타일', icon: '🖌️' },
    { key: 'color_palette', label: '색상 팔레트', icon: '🌈' },
    { key: 'texture_density', label: '디테일 밀도', icon: '🌿' },
    { key: 'perspective', label: '시점', icon: '📐' },
    { key: 'edge_softness', label: '경계 부드러움', icon: '〰️' },
    { key: 'lighting_direction', label: '광원 방향', icon: '💡' },
  ];

  return (
    <AnalysisCard<TilemapSpecificAnalysis>
      title="타일맵 분석"
      icon={LayoutGrid}
      iconColor="text-lime-600"
      borderColor="border-lime-200"
      bgColor="bg-lime-100"
      hoverColor="hover:text-lime-600 hover:bg-lime-50"
      focusColor="border-lime-500 focus:ring-lime-500"
      data={tilemapAnalysis}
      fields={fields}
      onUpdate={onUpdate}
    />
  );
});
