import { ImageAnalysisResult } from '../types/analysis';
import { logger } from './logger';

/**
 * 간단한 해시 함수
 * 문자열을 숫자 해시로 변환한 후 36진수 문자열로 반환
 * @param str 해시할 문자열
 * @returns 36진수 해시 문자열
 */
function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash = hash & hash; // 32비트 정수로 변환
  }
  return hash.toString(36);
}

/**
 * 섹션 데이터를 해시로 변환
 * 객체를 정렬된 JSON 문자열로 변환한 후 해시 생성
 * @param data 해시할 섹션 데이터 (StyleAnalysis, CharacterAnalysis, CompositionAnalysis 등)
 * @returns 해시 문자열
 */
export function hashSection(data: unknown): string {
  if (!data || typeof data !== 'object') return '';

  // 객체의 키를 정렬하여 일관된 순서로 JSON 변환
  const json = JSON.stringify(data, Object.keys(data as Record<string, unknown>).sort());
  return simpleHash(json);
}

/**
 * 변경된 섹션 감지
 * 이전 분석 결과와 새로운 분석 결과를 비교하여 변경된 섹션 목록 반환
 * @param oldAnalysis 이전 분석 결과 (null이면 최초 분석으로 간주)
 * @param newAnalysis 새로운 분석 결과
 * @returns 변경된 섹션 이름 배열 ('style', 'character', 'composition', 'prompts')
 */
export function detectChangedSections(
  oldAnalysis: ImageAnalysisResult | null,
  newAnalysis: ImageAnalysisResult
): ('style' | 'character' | 'composition' | 'prompts')[] {
  // 최초 분석인 경우 모든 섹션 반환
  if (!oldAnalysis) {
    logger.debug('🆕 [변경 감지] 최초 분석 - 모든 섹션 번역 필요');
    return ['style', 'character', 'composition', 'prompts'];
  }

  const changed: ('style' | 'character' | 'composition' | 'prompts')[] = [];

  // Style 섹션 비교
  const oldStyleHash = hashSection(oldAnalysis.style);
  const newStyleHash = hashSection(newAnalysis.style);
  if (oldStyleHash !== newStyleHash) {
    logger.debug('📝 [변경 감지] Style 섹션 변경됨');
    changed.push('style');
  }

  // Character 섹션 비교
  const oldCharacterHash = hashSection(oldAnalysis.character);
  const newCharacterHash = hashSection(newAnalysis.character);
  if (oldCharacterHash !== newCharacterHash) {
    logger.debug('👤 [변경 감지] Character 섹션 변경됨');
    logger.debug('   - 이전 해시:', oldCharacterHash);
    logger.debug('   - 새 해시:', newCharacterHash);
    logger.debug('   - 이전 데이터:', oldAnalysis.character);
    logger.debug('   - 새 데이터:', newAnalysis.character);
    changed.push('character');
  }

  // Composition 섹션 비교
  const oldCompositionHash = hashSection(oldAnalysis.composition);
  const newCompositionHash = hashSection(newAnalysis.composition);
  if (oldCompositionHash !== newCompositionHash) {
    logger.debug('🎨 [변경 감지] Composition 섹션 변경됨');
    changed.push('composition');
  }

  // Prompts는 번역 버튼을 통해 수동으로 번역하므로 변경 감지 제거

  // 변경 사항 요약 로그
  if (changed.length === 0) {
    logger.debug('✅ [변경 감지] 변경 사항 없음 - 번역 스킵');
  } else {
    logger.debug(`🔄 [변경 감지] ${changed.length}개 섹션 변경: ${changed.join(', ')}`);
  }

  return changed;
}
