import { logger } from '../lib/logger';

/**
 * Gemini API에서 사용 가능한 모든 모델 조회
 */
export async function listAvailableModels(apiKey: string): Promise<void> {
  try {
    logger.debug('🔍 Gemini API 사용 가능 모델 조회 중...');

    const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;
    const response = await fetch(url);

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('❌ 모델 리스트 조회 실패:', response.status, errorText);
      return;
    }

    const result = await response.json();
    const models = result.models || [];

    logger.debug('📋 사용 가능한 Gemini 모델:');
    logger.debug('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    // 이미지 생성 가능한 모델만 필터링
    const imageModels = models.filter((model: any) => {
      const supportedActions = model.supportedGenerationMethods || [];
      return supportedActions.includes('generateContent');
    });

    if (imageModels.length === 0) {
      logger.warn('⚠️ 이미지 생성 가능한 모델이 없습니다!');
    }

    imageModels.forEach((model: any) => {
      const modelName = model.name.replace('models/', '');
      const displayName = model.displayName || modelName;
      const description = model.description || '설명 없음';
      const version = model.version || 'unknown';

      logger.debug(`\n📦 ${displayName}`);
      logger.debug(`   - 모델명: ${modelName}`);
      logger.debug(`   - 버전: ${version}`);
      logger.debug(`   - 설명: ${description}`);
      logger.debug(`   - 지원 기능: ${(model.supportedGenerationMethods || []).join(', ')}`);
    });

    logger.debug('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    // 현재 앱에서 사용 중인 모델 확인
    const currentModel = 'gemini-3-pro-image-preview';
    const isAvailable = imageModels.some((model: any) =>
      model.name.includes(currentModel)
    );

    if (isAvailable) {
      logger.debug(`✅ 현재 사용 중인 모델 (${currentModel})은 사용 가능합니다.`);
    } else {
      logger.error(`❌ 현재 사용 중인 모델 (${currentModel})을 찾을 수 없습니다!`);
      logger.error('   대체 가능한 모델:');
      imageModels.slice(0, 3).forEach((model: any) => {
        const modelName = model.name.replace('models/', '');
        logger.error(`   - ${modelName}`);
      });
    }
  } catch (error) {
    logger.error('❌ 모델 리스트 조회 오류:', error);
  }
}

/**
 * 특정 모델이 사용 가능한지 확인
 */
export async function checkModelAvailability(
  apiKey: string,
  modelName: string
): Promise<boolean> {
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}?key=${apiKey}`;
    const response = await fetch(url);

    if (response.ok) {
      const model = await response.json();
      logger.debug(`✅ 모델 "${modelName}" 사용 가능`);
      logger.debug('   - 지원 기능:', model.supportedGenerationMethods?.join(', '));
      return true;
    } else {
      logger.error(`❌ 모델 "${modelName}" 사용 불가 (${response.status})`);
      return false;
    }
  } catch (error) {
    logger.error(`❌ 모델 "${modelName}" 확인 오류:`, error);
    return false;
  }
}
