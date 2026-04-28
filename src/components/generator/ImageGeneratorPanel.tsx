import { useState, useMemo, useEffect, useCallback } from 'react';
import { Wand2, ArrowLeft, ChevronDown, HelpCircle, X, FolderOpen, ZoomIn } from 'lucide-react';
import { save } from '@tauri-apps/plugin-dialog';
import { writeFile } from '@tauri-apps/plugin-fs';
import { openPath } from '@tauri-apps/plugin-opener';
import { join } from '@tauri-apps/api/path';
import { getAiGenRoot, getSessionImageFolder } from '../../lib/config/paths';
import { ImageAnalysisResult } from '../../types/analysis';
import { SessionType, GenerationHistoryEntry } from '../../types/session';
import { PixelArtGridLayout } from '../../types/pixelart';
import { ReferenceDocument } from '../../types/referenceDocument';
import { IllustrationSessionData, ILLUSTRATION_LIMITS } from '../../types/illustration';
import { getCameraAnglePrompt } from '../../types/cameraAngle';
import { getCameraLensPrompt } from '../../types/cameraLens';
import { buildUnifiedPrompt } from '../../lib/promptBuilder';
import { buildPromptForSession } from '../../lib/prompts/sessionPrompts';
import { useGeminiImageGenerator } from '../../hooks/api/useGeminiImageGenerator';
import { useOpenAIImageGenerator } from '../../hooks/api/useOpenAIImageGenerator';
import { useGeminiTranslator } from '../../hooks/api/useGeminiTranslator';
import { logger } from '../../lib/logger';
import { GeneratorSettings } from './GeneratorSettings';
import { GeneratorPreview } from './GeneratorPreview';
import { GeneratorHistory } from './GeneratorHistory';
import {
  getAvailableImageModels,
  DEFAULT_IMAGE_MODEL,
  type GeminiImageGenerationModel,
  getImageModelDefinition,
  isOpenAIModel,
  type ImageGenerationModel,
  type ImageQualityOption,
} from '../../hooks/api/imageModels';
import {
  IMAGE_GENERATION_DEFAULTS,
  ADVANCED_SETTINGS_DEFAULTS,
  HISTORY_PANEL,
} from '../../types/constants';

// 흰색 배경 제거 대상 세션 타입 (없음 - 모든 타입 JPG 저장)
const TRANSPARENT_BACKGROUND_SESSION_TYPES: SessionType[] = [];

/**
 * 이미지에서 흰색/밝은 배경을 투명하게 변환 (Flood Fill + Defringe 알고리즘)
 * 이미지 가장자리에서 시작하여 연결된 흰색 영역만 제거합니다.
 * 캐릭터 내부의 흰색(눈 하이라이트, 빛 반사 등)은 보존됩니다.
 * Defringe 처리로 외곽의 화이트 매트(white matte)를 제거합니다.
 *
 * @param imageDataUrl - Base64 이미지 Data URL
 * @param threshold - 흰색으로 간주할 RGB 임계값 (기본 240)
 * @returns 투명 배경이 적용된 PNG Data URL
 */
async function removeWhiteBackground(imageDataUrl: string, threshold: number = 240): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      try {
        // Canvas 생성
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');

        if (!ctx) {
          reject(new Error('Canvas 2D context를 생성할 수 없습니다'));
          return;
        }

        // 이미지 그리기
        ctx.drawImage(img, 0, 0);

        // 픽셀 데이터 가져오기
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;
        const width = canvas.width;
        const height = canvas.height;

        // 픽셀이 흰색인지 확인하는 함수
        const isWhitePixel = (index: number): boolean => {
          const r = data[index];
          const g = data[index + 1];
          const b = data[index + 2];
          return r > threshold && g > threshold && b > threshold;
        };

        // 좌표를 1차원 인덱스로 변환
        const getIndex = (x: number, y: number): number => (y * width + x) * 4;

        // 방문 여부 추적 (투명하게 만들 픽셀)
        const toMakeTransparent = new Set<number>();

        // BFS (Breadth-First Search)를 사용한 Flood Fill
        // 이미지 가장자리의 모든 흰색 픽셀에서 시작
        const queue: [number, number][] = [];
        const visited = new Set<string>();

        // 가장자리 픽셀들을 시작점으로 추가
        // 상단 및 하단 가장자리
        for (let x = 0; x < width; x++) {
          if (isWhitePixel(getIndex(x, 0))) {
            queue.push([x, 0]);
            visited.add(`${x},0`);
          }
          if (isWhitePixel(getIndex(x, height - 1))) {
            queue.push([x, height - 1]);
            visited.add(`${x},${height - 1}`);
          }
        }
        // 좌측 및 우측 가장자리
        for (let y = 1; y < height - 1; y++) {
          if (isWhitePixel(getIndex(0, y))) {
            queue.push([0, y]);
            visited.add(`0,${y}`);
          }
          if (isWhitePixel(getIndex(width - 1, y))) {
            queue.push([width - 1, y]);
            visited.add(`${width - 1},${y}`);
          }
        }

        // BFS 실행
        const directions = [
          [-1, 0], [1, 0], [0, -1], [0, 1], // 상하좌우
          [-1, -1], [-1, 1], [1, -1], [1, 1] // 대각선 (더 정밀한 경계 처리)
        ];

        while (queue.length > 0) {
          const [x, y] = queue.shift()!;
          const index = getIndex(x, y);

          // 이 픽셀을 투명하게 만들 목록에 추가
          toMakeTransparent.add(index);

          // 인접 픽셀 확인
          for (const [dx, dy] of directions) {
            const nx = x + dx;
            const ny = y + dy;
            const key = `${nx},${ny}`;

            // 범위 체크
            if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
            // 이미 방문한 픽셀 건너뛰기
            if (visited.has(key)) continue;

            const nIndex = getIndex(nx, ny);

            // 흰색 픽셀이면 큐에 추가
            if (isWhitePixel(nIndex)) {
              visited.add(key);
              queue.push([nx, ny]);
            }
          }
        }

        // 1단계: 연결된 흰색 배경 픽셀을 투명하게 처리
        for (const index of toMakeTransparent) {
          data[index + 3] = 0; // Alpha를 0으로 설정 (완전 투명)
        }

        // 2단계: 거리 맵 생성 (각 픽셀이 투명 영역에서 얼마나 떨어져 있는지)
        const distanceMap = new Map<number, number>(); // index -> distance

        // BFS로 거리 계산 (투명 영역에서 시작)
        const distanceQueue: [number, number, number][] = []; // [x, y, distance]
        const distanceVisited = new Set<string>();

        // 투명 영역과 인접한 불투명 픽셀을 시작점으로
        for (const transparentIndex of toMakeTransparent) {
          const pixelIndex = transparentIndex / 4;
          const x = pixelIndex % width;
          const y = Math.floor(pixelIndex / width);

          for (const [dx, dy] of directions) {
            const nx = x + dx;
            const ny = y + dy;
            const key = `${nx},${ny}`;

            if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
            if (distanceVisited.has(key)) continue;

            const nIndex = getIndex(nx, ny);
            if (data[nIndex + 3] > 0 && !toMakeTransparent.has(nIndex)) {
              distanceVisited.add(key);
              distanceQueue.push([nx, ny, 1]);
              distanceMap.set(nIndex, 1);
            }
          }
        }

        // 거리 전파 (feather 범위만큼)
        const featherRadius = 6; // Feather 반경 (픽셀)
        while (distanceQueue.length > 0) {
          const [x, y, dist] = distanceQueue.shift()!;

          if (dist >= featherRadius) continue;

          for (const [dx, dy] of directions.slice(0, 4)) { // 4방향
            const nx = x + dx;
            const ny = y + dy;
            const key = `${nx},${ny}`;

            if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
            if (distanceVisited.has(key)) continue;

            const nIndex = getIndex(nx, ny);
            if (data[nIndex + 3] > 0 && !toMakeTransparent.has(nIndex)) {
              distanceVisited.add(key);
              distanceQueue.push([nx, ny, dist + 1]);
              distanceMap.set(nIndex, dist + 1);
            }
          }
        }

        // 3단계: Defringe + Feather 처리
        for (const [index, distance] of distanceMap) {
          const r = data[index];
          const g = data[index + 1];
          const b = data[index + 2];
          const a = data[index + 3];

          if (a === 0) continue;

          // 흰색 성분 계산
          const minRGB = Math.min(r, g, b);
          const whiteness = minRGB / 255;
          const brightness = (r + g + b) / 3 / 255;

          // 거리에 따른 처리 강도 (가까울수록 강하게)
          const distanceFactor = 1 - (distance - 1) / featherRadius;

          // === 흰색 매트 제거 (Defringe) ===
          if (whiteness > 0.3) {
            // 흰색 성분 제거 강도 (거리와 밝기에 비례)
            const removalStrength = distanceFactor * Math.min(1, whiteness * 1.5);
            const whiteToRemove = minRGB * removalStrength * 0.9;

            data[index] = Math.max(0, Math.round(r - whiteToRemove));
            data[index + 1] = Math.max(0, Math.round(g - whiteToRemove));
            data[index + 2] = Math.max(0, Math.round(b - whiteToRemove));
          }

          // === Feather 효과 (부드러운 투명 경계) ===
          if (distance === 1) {
            // 가장 바깥쪽 (1픽셀): 매우 강한 투명 처리
            if (brightness > 0.6) {
              data[index + 3] = Math.round(a * 0.05); // 거의 완전 투명
            } else if (brightness > 0.4) {
              data[index + 3] = Math.round(a * 0.15);
            } else {
              data[index + 3] = Math.round(a * 0.35);
            }
          } else if (distance === 2) {
            // 2번째 픽셀: 강한 투명 처리
            if (brightness > 0.6) {
              data[index + 3] = Math.round(a * 0.2);
            } else if (brightness > 0.4) {
              data[index + 3] = Math.round(a * 0.4);
            } else {
              data[index + 3] = Math.round(a * 0.6);
            }
          } else if (distance === 3) {
            // 3번째 픽셀: 중간 투명 처리
            if (brightness > 0.6) {
              data[index + 3] = Math.round(a * 0.5);
            } else if (brightness > 0.4) {
              data[index + 3] = Math.round(a * 0.7);
            } else {
              data[index + 3] = Math.round(a * 0.85);
            }
          } else if (distance === 4) {
            // 4번째 픽셀: 약한 투명 처리
            if (brightness > 0.6) {
              data[index + 3] = Math.round(a * 0.75);
            } else {
              data[index + 3] = Math.round(a * 0.9);
            }
          } else if (distance === 5) {
            // 5번째 픽셀: 미세한 투명 처리
            if (brightness > 0.6) {
              data[index + 3] = Math.round(a * 0.9);
            }
          }
          // distance >= 6: 원본 유지
        }

        // 4단계: 추가 경계 정리 (아직 남은 밝은 외곽 픽셀 처리)
        for (const [index, distance] of distanceMap) {
          if (distance !== 1) continue;

          const r = data[index];
          const g = data[index + 1];
          const b = data[index + 2];
          const a = data[index + 3];

          // 이미 투명해진 픽셀 건너뛰기
          if (a < 50) continue;

          // 아직 밝은 픽셀이면 추가 처리
          const brightness = (r + g + b) / 3;
          if (brightness > 180) {
            data[index + 3] = Math.round(a * 0.3);
          }
        }

        // 수정된 데이터 적용
        ctx.putImageData(imageData, 0, 0);

        // PNG로 변환 (투명도 지원)
        const pngDataUrl = canvas.toDataURL('image/png');
        resolve(pngDataUrl);
      } catch (error) {
        reject(error);
      }
    };
    img.onerror = () => {
      reject(new Error('이미지 로드에 실패했습니다'));
    };
    img.src = imageDataUrl;
  });
}

interface ImageGeneratorPanelProps {
  geminiApiKey: string;
  openaiApiKey: string;
  analysis: ImageAnalysisResult;
  referenceImages: string[];
  sessionType: SessionType;
  sessionName: string; // v0.4.4: 세션 이름 (저장 폴더 경로 생성용)
  generationHistory?: GenerationHistoryEntry[];
  onHistoryAdd?: (entry: GenerationHistoryEntry) => void;
  onHistoryUpdate?: (entryId: string, updates: Partial<GenerationHistoryEntry>) => void;
  onHistoryDelete?: (entryId: string) => void;
  onBack?: () => void;
  referenceDocuments?: ReferenceDocument[]; // 참조 문서 (UI 세션 전용)
  onDocumentAdd?: (document: ReferenceDocument) => void;
  onDocumentDelete?: (documentId: string) => void;
  illustrationData?: IllustrationSessionData; // 일러스트 세션 전용 데이터
}

// 통합 상태 타입 정의
interface GeneratorState {
  additionalPrompt: string;
  isTranslating: boolean;
  aspectRatio: '1:1' | '16:9' | '9:16' | '4:3' | '3:4';
  imageSize: '1K' | '2K' | '4K';
  useReferenceImages: boolean;
  isGenerating: boolean;
  progressMessage: string;
  generatedImage: string | null;
  pixelArtGrid: PixelArtGridLayout;
  cameraAngle: string;  // 카메라 앵글 프리셋 ID
  cameraLens: string;   // 카메라 렌즈/화각 프리셋 ID
  zoomLevel: 'fit' | 'actual' | number;
  showZoomMenu: boolean;
  showPathTooltip: boolean;
  showAdvanced: boolean;
  showHelp: boolean;
  seed: number | undefined;
  temperature: number;
  topK: number;
  topP: number;
  referenceStrength: number;
  historyHeight: number;
  imageModel: ImageGenerationModel;
  imageQuality: ImageQualityOption;
}

export function ImageGeneratorPanel({
  geminiApiKey,
  openaiApiKey,
  analysis,
  referenceImages,
  sessionType,
  sessionName,
  generationHistory = [],
  onHistoryAdd,
  onHistoryUpdate,
  onHistoryDelete,
  onBack,
  referenceDocuments = [],
  onDocumentAdd,
  onDocumentDelete,
  illustrationData,
}: ImageGeneratorPanelProps) {
  const { positivePrompt, negativePrompt } = useMemo(
    () => buildUnifiedPrompt(analysis),
    [analysis]
  );
  const { generateImage } = useGeminiImageGenerator();
  const { generateImage: generateOpenAIImage } = useOpenAIImageGenerator();
  const { translateToEnglish, containsKorean } = useGeminiTranslator();
  const hasOpenAIApiKey = openaiApiKey.trim().length > 0;

  // 통합 상태 관리
  const [state, setState] = useState<GeneratorState>({
    additionalPrompt: '',
    isTranslating: false,
    aspectRatio: IMAGE_GENERATION_DEFAULTS.ASPECT_RATIO,
    imageSize: IMAGE_GENERATION_DEFAULTS.IMAGE_SIZE,
    useReferenceImages: IMAGE_GENERATION_DEFAULTS.USE_REFERENCE_IMAGES,
    isGenerating: false,
    progressMessage: '',
    generatedImage: null,
    pixelArtGrid: IMAGE_GENERATION_DEFAULTS.PIXEL_ART_GRID,
    cameraAngle: 'none',  // 기본값: 선택 안함
    cameraLens: 'none',   // 기본값: 선택 안함
    zoomLevel: 'fit',
    showZoomMenu: false,
    showPathTooltip: false,
    showAdvanced: false,
    showHelp: false,
    seed: undefined,
    temperature: ADVANCED_SETTINGS_DEFAULTS.TEMPERATURE,
    topK: ADVANCED_SETTINGS_DEFAULTS.TOP_K,
    topP: ADVANCED_SETTINGS_DEFAULTS.TOP_P,
    referenceStrength: ADVANCED_SETTINGS_DEFAULTS.REFERENCE_STRENGTH,
    historyHeight: HISTORY_PANEL.DEFAULT_HEIGHT,
    imageModel: DEFAULT_IMAGE_MODEL,
    imageQuality: 'medium',
  });

  // 상태 업데이트 헬퍼 함수 (useCallback으로 안정화하여 자식 메모이제이션 유지)
  const updateState = useCallback((updates: Partial<GeneratorState>) => {
    setState(prev => ({ ...prev, ...updates }));
  }, []);

  // 상태에서 자주 사용되는 값들을 destructure
  const {
    additionalPrompt,
    isTranslating,
    aspectRatio,
    imageSize,
    useReferenceImages,
    isGenerating,
    progressMessage,
    generatedImage,
    pixelArtGrid,
    cameraAngle,
    cameraLens,
    zoomLevel,
    showZoomMenu,
    showPathTooltip,
    showAdvanced,
    showHelp,
    seed,
    temperature,
    topK,
    topP,
    referenceStrength,
    historyHeight,
    imageModel,
    imageQuality,
  } = state;

  // 기존 코드 호환성을 위한 개별 setter 함수들 (useCallback으로 안정화)
  const setAdditionalPrompt = useCallback((value: string) => updateState({ additionalPrompt: value }), [updateState]);
  const setIsTranslating = useCallback((value: boolean) => updateState({ isTranslating: value }), [updateState]);
  const setAspectRatio = useCallback((value: '1:1' | '16:9' | '9:16' | '4:3' | '3:4') => updateState({ aspectRatio: value }), [updateState]);
  const setImageSize = useCallback((value: '1K' | '2K' | '4K') => updateState({ imageSize: value }), [updateState]);
  const setUseReferenceImages = useCallback((value: boolean) => updateState({ useReferenceImages: value }), [updateState]);
  const setIsGenerating = useCallback((value: boolean) => updateState({ isGenerating: value }), [updateState]);
  const setProgressMessage = useCallback((value: string) => updateState({ progressMessage: value }), [updateState]);
  const setGeneratedImage = useCallback((value: string | null) => updateState({ generatedImage: value }), [updateState]);
  const setPixelArtGrid = useCallback((value: PixelArtGridLayout) => updateState({ pixelArtGrid: value }), [updateState]);
  const setCameraAngle = useCallback((value: string) => updateState({ cameraAngle: value }), [updateState]);
  const setCameraLens = useCallback((value: string) => updateState({ cameraLens: value }), [updateState]);
  const setZoomLevel = useCallback((value: 'fit' | 'actual' | number) => updateState({ zoomLevel: value }), [updateState]);
  const setShowZoomMenu = useCallback((value: boolean) => updateState({ showZoomMenu: value }), [updateState]);
  const setShowPathTooltip = useCallback((value: boolean) => updateState({ showPathTooltip: value }), [updateState]);
  const setShowAdvanced = useCallback((value: boolean) => updateState({ showAdvanced: value }), [updateState]);
  const setShowHelp = useCallback((value: boolean) => updateState({ showHelp: value }), [updateState]);
  const setSeed = useCallback((value: number | undefined) => updateState({ seed: value }), [updateState]);
  const setTemperature = useCallback((value: number) => updateState({ temperature: value }), [updateState]);
  const setTopK = useCallback((value: number) => updateState({ topK: value }), [updateState]);
  const setTopP = useCallback((value: number) => updateState({ topP: value }), [updateState]);
  const setImageModel = useCallback((value: ImageGenerationModel) => updateState({ imageModel: value }), [updateState]);
  const setImageQuality = useCallback((value: ImageQualityOption) => updateState({ imageQuality: value }), [updateState]);

  // 줌 메뉴 외부 클릭 시 닫기
  useEffect(() => {
    if (showZoomMenu) {
      const handleClickOutside = () => updateState({ showZoomMenu: false });
      document.addEventListener('click', handleClickOutside);
      return () => document.removeEventListener('click', handleClickOutside);
    }
  }, [showZoomMenu]);

  useEffect(() => {
    const modelDef = getImageModelDefinition(imageModel);
    const nextState: Partial<GeneratorState> = {};

    if (!modelDef.supports.aspectRatios.includes(aspectRatio)) {
      nextState.aspectRatio = modelDef.supports.aspectRatios[0];
    }
    if (!modelDef.supports.imageSizes.includes(imageSize)) {
      nextState.imageSize = modelDef.supports.imageSizes[0];
    }

    if (Object.keys(nextState).length > 0) {
      updateState(nextState);
    }
  }, [imageModel, aspectRatio, imageSize, updateState]);

  // setState updater 패턴 + useCallback으로 자식 memo 무효화 방지
  const handleHistoryResize = useCallback((delta: number) => {
    setState(prev => ({
      ...prev,
      historyHeight: Math.max(120, Math.min(600, prev.historyHeight - delta)),
    }));
  }, []);


  const handleGenerate = async () => {
    const selectedModel = getImageModelDefinition(imageModel);
    const useOpenAI = isOpenAIModel(imageModel);
    const selectedApiKey = useOpenAI ? openaiApiKey : geminiApiKey;

    if (!selectedApiKey) {
      alert(
        useOpenAI
          ? 'ChatGPT API 키를 먼저 설정해주세요. Style Studio 헤더의 설정 아이콘에서 입력할 수 있습니다.'
          : 'Gemini API 키를 먼저 설정해주세요. Style Studio 헤더의 설정 아이콘에서 입력할 수 있습니다.'
      );
      return;
    }

    setIsGenerating(true);
    setProgressMessage('이미지 생성 준비 중...');
    setGeneratedImage(null);

    try {
      // 1단계: 한국어 프롬프트를 영어로 번역
      setIsTranslating(true);
      setProgressMessage('프롬프트를 영어로 변환 중...');

      // 추가 프롬프트: 한글이면 번역, 영어면 그대로 사용
      let translatedAdditionalPrompt = '';
      if (additionalPrompt.trim()) {
        if (containsKorean(additionalPrompt.trim())) {
          logger.debug('🌐 추가 프롬프트 번역 중...');
          translatedAdditionalPrompt = await translateToEnglish(geminiApiKey, additionalPrompt.trim());
        } else {
          translatedAdditionalPrompt = additionalPrompt.trim();
        }
      }

      setIsTranslating(false);
      logger.debug('✅ 프롬프트 준비 완료');
      logger.debug('   - 추가 프롬프트:', translatedAdditionalPrompt);

      // 2단계: 최종 프롬프트 구성 (영어 사용)
      let finalPrompt = '';

      // 카메라 앵글 및 렌즈 프롬프트 가져오기
      const cameraAnglePrompt = getCameraAnglePrompt(cameraAngle);
      const cameraLensPrompt = getCameraLensPrompt(cameraLens);

      // 카메라 설정 프롬프트 합치기
      const cameraSettingsStr = [cameraAnglePrompt, cameraLensPrompt].filter(Boolean).join(', ');

      if (sessionType === 'ILLUSTRATION' && illustrationData) {
        // 일러스트 세션: 카메라 설정을 basePrompt에 포함하지 않고 별도로 전달
        // 캐릭터 복제가 최우선이므로 카메라 설정은 별도 섹션으로 처리
        const basePromptParts = [translatedAdditionalPrompt].filter(Boolean);
        const basePrompt = basePromptParts.join(', ');
        finalPrompt = buildPromptForSession({
          basePrompt: basePrompt || 'Create an illustration with the characters',
          hasReferenceImages: true,
          sessionType: 'ILLUSTRATION',
          illustrationData: illustrationData,
          pixelArtGrid: pixelArtGrid, // 그리드 레이아웃 전달
          cameraSettings: cameraSettingsStr || undefined, // 카메라 설정 별도 전달
        });
      } else {
        // 모든 세션 타입: buildPromptForSession으로 통합 처리
        const hasRefImages = useReferenceImages && referenceImages.length > 0;
        const basePromptParts = [translatedAdditionalPrompt].filter(Boolean);

        // 카메라 설정 추가
        if (cameraSettingsStr) {
          basePromptParts.push(cameraSettingsStr);
        }

        // 참조 이미지가 없으면 분석 프롬프트도 포함
        if (!hasRefImages) {
          basePromptParts.push(positivePrompt);
        }

        const basePrompt = basePromptParts.filter(Boolean).join(', ') || positivePrompt;

        finalPrompt = buildPromptForSession({
          basePrompt,
          hasReferenceImages: hasRefImages,
          sessionType,
          pixelArtGrid,
          analysis,
          referenceDocuments,
        });
      }

      logger.debug('🎨 최종 프롬프트 (영어):', finalPrompt);

      // 3단계: 이미지 생성
      // ILLUSTRATION 세션의 경우 캐릭터 및 배경 참조 이미지 수집 (캐릭터당 최대 3장)
      let finalReferenceImages: string[] | undefined;
      if (sessionType === 'ILLUSTRATION' && illustrationData) {
        const allImages: string[] = [];
        // 캐릭터 참조 이미지 수집 (캐릭터당 최대 ILLUSTRATION_LIMITS.MAX_IMAGES_PER_CHARACTER장)
        illustrationData.characters.forEach(char => {
          if (char.images && char.images.length > 0) {
            const limitedImages = char.images.slice(0, ILLUSTRATION_LIMITS.MAX_IMAGES_PER_CHARACTER);
            allImages.push(...limitedImages);
            logger.debug(`   - ${char.name}: ${limitedImages.length}장 (최대 ${ILLUSTRATION_LIMITS.MAX_IMAGES_PER_CHARACTER}장)`);
          }
        });
        // 배경 참조 이미지 수집
        if (illustrationData.backgroundImages && illustrationData.backgroundImages.length > 0) {
          allImages.push(...illustrationData.backgroundImages);
        }
        finalReferenceImages = allImages.length > 0 ? allImages : undefined;
        logger.debug(`📸 ILLUSTRATION 참조 이미지 총: ${allImages.length}장`);
      } else if (sessionType === 'CHARACTER' || useReferenceImages) {
        finalReferenceImages = referenceImages;
      }

      const callbacks = {
        onProgress: (message: string) => {
          setProgressMessage(message);
          logger.debug('📊 진행:', message);
        },
        onComplete: async (imageBase64: string) => {
            // Gemini API는 JPEG 바이너리를 반환하므로 올바른 MIME 타입 사용
            let dataUrl = `data:image/jpeg;base64,${imageBase64}`;

            // 흰색 배경 제거 대상 세션 타입인지 확인
            const shouldRemoveBackground = TRANSPARENT_BACKGROUND_SESSION_TYPES.includes(sessionType);

            if (shouldRemoveBackground) {
              setProgressMessage('배경 제거 중...');
              logger.debug('🎨 흰색 배경 제거 시작...');
              try {
                dataUrl = await removeWhiteBackground(dataUrl, 240);
                logger.debug('✅ 배경 제거 완료');
              } catch (bgError) {
                logger.error('❌ 배경 제거 실패:', bgError);
                // 배경 제거 실패해도 원본 이미지 사용
              }
            }

            setGeneratedImage(dataUrl);
            setZoomLevel('fit'); // 이미지 생성 시 줌을 '화면에 맞춤'으로 리셋
            setIsGenerating(false);
            setIsTranslating(false);
            setProgressMessage('');
            logger.debug('✅ 생성 완료');

            // 자동 저장 (배경 제거 대상은 PNG, 그 외는 JPG)
            try {
              const savedPath = await autoSaveImage(dataUrl, shouldRemoveBackground);
              logger.debug('💾 자동 저장 완료:', savedPath);
            } catch (error) {
              logger.error('❌ 자동 저장 실패:', error);
              // 자동 저장 실패해도 이미지 표시는 계속
            }

            // 히스토리에 추가
            if (onHistoryAdd) {
              const historyEntry: GenerationHistoryEntry = {
                id: `gen-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
                timestamp: new Date().toISOString(),
                prompt: finalPrompt,
                negativePrompt: negativePrompt,
                additionalPrompt: additionalPrompt.trim() || undefined, // 추가 포즈/동작 프롬프트 (원본)
                imageBase64: dataUrl,
                settings: {
                  aspectRatio: aspectRatio,
                  imageSize: imageSize,
                  seed: seed,
                  temperature: temperature,
                  topK: topK,
                  topP: topP,
                  referenceStrength: referenceStrength,
                  useReferenceImages: sessionType === 'CHARACTER' || useReferenceImages,
                  pixelArtGrid: pixelArtGrid, // 스프라이트 그리드 레이아웃
                  cameraAngle: cameraAngle !== 'none' ? cameraAngle : undefined, // 카메라 앵글
                  cameraLens: cameraLens !== 'none' ? cameraLens : undefined,   // 카메라 렌즈/화각
                },
                referenceDocumentIds: referenceDocuments?.map(doc => doc.id), // 참조 문서 ID 목록
              };
              onHistoryAdd(historyEntry);
              logger.debug('📜 히스토리에 추가됨:', historyEntry.id);
            }
          },
        onError: (error: Error) => {
          setIsGenerating(false);
          setIsTranslating(false);
          setProgressMessage('');
          logger.error('❌ 생성 오류:', error);
          alert('이미지 생성 실패: ' + error.message);
        },
      };

      if (selectedModel.provider === 'openai') {
        await generateOpenAIImage(
          selectedApiKey,
          {
            prompt: finalPrompt,
            aspectRatio: aspectRatio,
            imageSize: imageSize,
            quality: imageQuality,
            referenceImages: finalReferenceImages,
          },
          callbacks
        );
      } else {
        const geminiModel = imageModel as GeminiImageGenerationModel;
        await generateImage(
          selectedApiKey,
          {
            prompt: finalPrompt,
            negativePrompt: negativePrompt,
            referenceImages: finalReferenceImages,
            aspectRatio: aspectRatio,
            imageSize: imageSize,
            sessionType: sessionType,
            // 고급 설정
            seed: seed,
            temperature: temperature,
            topK: topK,
            topP: topP,
            referenceStrength: referenceStrength,
            // 픽셀아트 전용 설정
            analysis: analysis, // 이미지 분석 결과 (픽셀아트 해상도 추출용)
            pixelArtGrid: pixelArtGrid, // 픽셀아트 그리드 레이아웃
            // UI 세션 전용 설정
            referenceDocuments: referenceDocuments, // 참조 문서 (UI 세션에서 기획 내용 반영)
            imageModel: geminiModel, // 이미지 생성 모델
          },
          callbacks
        );
      }
    } catch (error) {
      setIsGenerating(false);
      setIsTranslating(false);
      setProgressMessage('');
      logger.error('❌ 프롬프트 변환 또는 생성 오류:', error);
      alert('오류 발생: ' + (error as Error).message);
    }
  };

  // 자동 저장 함수 (세션별 폴더 고정, v0.4.4)
  const autoSaveImage = async (imageDataUrl: string, saveAsPng: boolean = false) => {
    try {
      // Data URL 형식 검증
      if (!imageDataUrl || !imageDataUrl.startsWith('data:')) {
        throw new Error('유효하지 않은 이미지 데이터 형식입니다');
      }

      // 저장 경로 결정 (v0.4.4: 세션별 폴더 고정)
      const savePath = await getSessionImageFolder(sessionName);
      logger.debug('🔍 저장 경로:', savePath);

      // 파일명 생성
      const timestamp = Date.now();
      const fileExtension = saveAsPng ? 'png' : 'jpg';
      const fileName = `style-studio-${timestamp}.${fileExtension}`;
      const fullPath = await join(savePath, fileName);

      logger.debug('💾 자동 저장 시작:', fullPath);

      // Base64를 Uint8Array로 변환 (원본 그대로 저장)
      const base64Data = imageDataUrl.split(',')[1];
      if (!base64Data) {
        throw new Error('Base64 데이터를 추출할 수 없습니다. Data URL 형식이 잘못되었습니다.');
      }

      let binaryString: string;
      try {
        binaryString = atob(base64Data);
      } catch (atobError) {
        logger.error('❌ Base64 디코딩 실패:', atobError);
        throw new Error('Base64 디코딩에 실패했습니다. 이미지 데이터가 손상되었을 수 있습니다.');
      }

      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      await writeFile(fullPath, bytes);
      logger.debug('✅ 이미지 자동 저장 완료:', fullPath);

      return fullPath;
    } catch (error) {
      logger.error('❌ 자동 저장 오류:', error);
      throw error;
    }
  };

  // 수동 저장 함수 (사용자가 다운로드 버튼 클릭 시) — useCallback으로 자식 memo 유지
  const handleManualSave = useCallback(async () => {
    if (!generatedImage) {
      return;
    }

    // Base64 data URL 형식 검증
    if (!generatedImage.startsWith('data:')) {
      logger.error('❌ 유효하지 않은 이미지 형식:', generatedImage.substring(0, 50));
      alert('이미지 다운로드에 실패했습니다.\n\n이미지 데이터가 손상되었습니다. 세션을 다시 import하거나 이미지를 새로 생성해주세요.');
      return;
    }

    // 투명 배경 이미지인지 확인 (세션 타입 기반)
    const shouldSaveAsPng = TRANSPARENT_BACKGROUND_SESSION_TYPES.includes(sessionType);

    try {
      // 저장 경로 결정 (v0.4.4: 세션별 폴더 고정)
      const defaultPath = await getSessionImageFolder(sessionName);

      // 기본 파일명 생성 (투명 배경 이미지는 PNG, 그 외는 JPG)
      const timestamp = Date.now();
      const fileExtension = shouldSaveAsPng ? 'png' : 'jpg';
      const defaultFileName = `style-studio-${timestamp}.${fileExtension}`;
      const defaultFilePath = await join(defaultPath, defaultFileName);

      // Tauri의 save 다이얼로그 사용 (OS 네이티브, 덮어쓰기 자동 확인)
      const selectedPath = await save({
        defaultPath: defaultFilePath,
        filters: shouldSaveAsPng ? [
          {
            name: 'PNG Image',
            extensions: ['png'],
          },
        ] : [
          {
            name: 'JPEG Image',
            extensions: ['jpg', 'jpeg'],
          },
        ],
        title: '이미지 저장',
      });

      // 사용자가 취소한 경우
      if (!selectedPath) {
        logger.debug('💾 사용자가 저장 취소');
        return;
      }

      logger.debug('💾 수동 저장 경로:', selectedPath);
      logger.debug('   이미지 데이터 형식:', generatedImage.substring(0, 50) + '...');
      logger.debug('   이미지 데이터 길이:', generatedImage.length);

      // Base64를 Uint8Array로 변환
      const base64Data = generatedImage.split(',')[1];
      if (!base64Data) {
        throw new Error('Base64 데이터를 추출할 수 없습니다. Data URL 형식이 잘못되었습니다.');
      }

      logger.debug('   Base64 데이터 길이:', base64Data.length);

      // atob() 함수로 디코딩 시도
      let binaryString: string;
      try {
        binaryString = atob(base64Data);
      } catch (atobError) {
        logger.error('❌ Base64 디코딩 실패:', atobError);
        throw new Error('Base64 디코딩에 실패했습니다. 이미지 데이터가 손상되었을 수 있습니다.');
      }

      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      logger.debug('   바이너리 데이터 크기:', bytes.length, 'bytes');

      // 파일 저장
      await writeFile(selectedPath, bytes);
      logger.debug('✅ 이미지 수동 저장 완료:', selectedPath);

      alert(`이미지가 저장되었습니다.\n\n${selectedPath}`);
    } catch (error) {
      // 에러 정보를 더 자세히 로깅
      logger.error('❌ 수동 저장 오류 (상세):', {
        error,
        errorType: typeof error,
        errorConstructor: error?.constructor?.name,
        errorMessage: error instanceof Error ? error.message : String(error),
        errorStack: error instanceof Error ? error.stack : undefined,
      });

      // 사용자에게 표시할 에러 메시지
      let errorMessage = '알 수 없는 오류가 발생했습니다';
      if (error instanceof Error) {
        errorMessage = error.message;
      } else if (typeof error === 'string') {
        errorMessage = error;
      } else if (error && typeof error === 'object' && 'message' in error) {
        errorMessage = String((error as any).message);
      }

      alert('이미지 저장에 실패했습니다.\n\n' + errorMessage);
    }
  }, [generatedImage, sessionType, sessionName]);

  // 히스토리에서 설정 복원 (단일 setState + useCallback으로 자식 memo 유지)
  const handleRestoreFromHistory = useCallback((e: React.MouseEvent, entry: GenerationHistoryEntry) => {
    e.stopPropagation();
    logger.debug('🔄 히스토리에서 설정 복원:', entry.id);

    setState(prev => ({
      ...prev,
      aspectRatio: entry.settings.aspectRatio,
      imageSize: entry.settings.imageSize,
      useReferenceImages: entry.settings.useReferenceImages,
      seed: entry.settings.seed,
      temperature: entry.settings.temperature ?? 1.0,
      topK: entry.settings.topK ?? 40,
      topP: entry.settings.topP ?? 0.95,
      referenceStrength: entry.settings.referenceStrength ?? 1.0,
      pixelArtGrid: entry.settings.pixelArtGrid ?? prev.pixelArtGrid,
      cameraAngle: entry.settings.cameraAngle ?? 'none',
      cameraLens: entry.settings.cameraLens ?? 'none',
      additionalPrompt: entry.additionalPrompt ?? prev.additionalPrompt,
      generatedImage: entry.imageBase64,
    }));

    alert('설정이 복원되었습니다. 프롬프트를 수정한 후 "이미지 생성"을 클릭하세요.');
  }, []);

  // 히스토리 삭제 요청

  // 히스토리 핀 토글 (useCallback으로 안정화)
  const handleTogglePin = useCallback((e: React.MouseEvent, entryId: string) => {
    e.stopPropagation();
    if (!onHistoryUpdate) return;

    const entry = generationHistory.find((h) => h.id === entryId);
    if (!entry) return;

    onHistoryUpdate(entryId, { isPinned: !entry.isPinned });
    logger.debug(`📌 히스토리 핀 토글: ${entryId}, 새 상태: ${!entry.isPinned}`);
  }, [onHistoryUpdate, generationHistory]);

  return (
    <div className="h-full flex flex-col bg-gray-50">
      {/* 헤더 */}
      <div className="bg-white border-b border-gray-200 px-4 py-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {onBack && (
              <button
                onClick={onBack}
                className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                title="분석 화면으로 돌아가기"
              >
                <ArrowLeft size={20} className="text-gray-600" />
              </button>
            )}
            <div className="p-2 bg-gradient-to-r from-purple-600 to-blue-600 rounded-lg">
              <Wand2 size={24} className="text-white" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-gray-800">이미지 생성</h2>
              <p className="text-sm text-gray-500">
                {sessionType === 'CHARACTER'
                  ? '캐릭터 세션'
                  : sessionType === 'BACKGROUND'
                  ? '배경 세션'
                  : sessionType === 'ICON'
                  ? '아이콘 세션'
                  : sessionType === 'PIXELART_CHARACTER'
                  ? '픽셀 캐릭터 세션'
                  : sessionType === 'PIXELART_BACKGROUND'
                  ? '픽셀 배경 세션'
                  : sessionType === 'PIXELART_ICON'
                  ? '픽셀 아이콘 세션'
                  : sessionType === 'UI'
                  ? 'UI 디자인 세션'
                  : sessionType === 'LOGO'
                  ? '로고 세션'
                  : '스타일 세션'}{' '}
                · {getImageModelDefinition(imageModel).label}
              </p>
            </div>
          </div>
          {/* 자동 저장 폴더 열기 버튼 (v0.4.4) */}
          <div className="flex items-center gap-3">
            <button
              onClick={async () => {
                try {
                  const root = await getAiGenRoot();
                  await openPath(root);
                } catch (error) {
                  logger.error('❌ 저장 폴더 열기 실패:', error);
                  alert('저장 폴더를 열지 못했습니다.');
                }
              }}
              onMouseEnter={() => setShowPathTooltip(true)}
              onMouseLeave={() => setShowPathTooltip(false)}
              className="relative flex items-center gap-2 px-3 py-2 bg-green-50 border border-green-200 rounded-lg hover:bg-green-100 transition-colors"
              title="탐색기에서 저장 폴더 열기"
            >
              <FolderOpen size={16} className="text-green-600" />
              <span className="text-sm text-green-700 font-medium max-w-xs truncate">
                AI_Gen
              </span>

              {/* 커스텀 툴팁 */}
              {showPathTooltip && (
                <div className="absolute top-full right-0 mt-2 z-50 pointer-events-none">
                  <div className="bg-gray-900 text-white text-xs rounded-lg shadow-xl px-3 py-2 whitespace-nowrap">
                    <div className="font-semibold mb-1">저장 위치 (클릭하여 열기):</div>
                    <div className="text-gray-300">
                      ~/Downloads/AI_Gen/
                    </div>
                  </div>
                </div>
              )}
            </button>

            {/* 줌 컨트롤 */}
            {generatedImage && (
              <div className="relative">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowZoomMenu(!showZoomMenu);
                  }}
                  className="flex items-center gap-2 px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
                >
                  <ZoomIn size={18} />
                  <span className="text-sm font-medium">
                    {zoomLevel === 'fit' ? '화면에 맞춤' : zoomLevel === 'actual' ? '원본 크기' : `${zoomLevel}%`}
                  </span>
                  <ChevronDown size={16} />
                </button>

                {/* 줌 드롭다운 메뉴 */}
                {showZoomMenu && (
                  <div
                    onClick={(e) => e.stopPropagation()}
                    className="absolute top-full mt-2 right-0 bg-white border border-gray-200 rounded-lg shadow-xl z-50 py-2 min-w-[180px]"
                  >
                    <button
                      onClick={() => {
                        setZoomLevel('fit');
                        setShowZoomMenu(false);
                      }}
                      className={`w-full px-4 py-2 text-left text-sm hover:bg-gray-100 transition-colors ${
                        zoomLevel === 'fit' ? 'bg-purple-50 text-purple-700 font-semibold' : 'text-gray-700'
                      }`}
                    >
                      화면에 맞춤
                    </button>
                    <button
                      onClick={() => {
                        setZoomLevel('actual');
                        setShowZoomMenu(false);
                      }}
                      className={`w-full px-4 py-2 text-left text-sm hover:bg-gray-100 transition-colors ${
                        zoomLevel === 'actual' ? 'bg-purple-50 text-purple-700 font-semibold' : 'text-gray-700'
                      }`}
                    >
                      원본 크기 (100%)
                    </button>
                    <div className="border-t border-gray-200 my-2"></div>
                    {[25, 50, 75, 100, 150, 200, 300].map((level) => (
                      <button
                        key={level}
                        onClick={() => {
                          setZoomLevel(level);
                          setShowZoomMenu(false);
                        }}
                        className={`w-full px-4 py-2 text-left text-sm hover:bg-gray-100 transition-colors ${
                          zoomLevel === level ? 'bg-purple-50 text-purple-700 font-semibold' : 'text-gray-700'
                        }`}
                      >
                        {level}%
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* 왼쪽: 설정 패널 */}
        <GeneratorSettings
          geminiApiKey={geminiApiKey}
          openaiApiKey={openaiApiKey}
          sessionType={sessionType}
          additionalPrompt={additionalPrompt}
          isGenerating={isGenerating}
          isTranslating={isTranslating}
          progressMessage={progressMessage}
          aspectRatio={aspectRatio}
          imageSize={imageSize}
          useReferenceImages={useReferenceImages}
          pixelArtGrid={pixelArtGrid}
          showAdvanced={showAdvanced}
          showHelp={showHelp}
          seed={seed}
          temperature={temperature}
          topK={topK}
          topP={topP}
          imageModel={imageModel}
          imageQuality={imageQuality}
          availableModels={getAvailableImageModels(hasOpenAIApiKey)}
          supportedAspectRatios={getImageModelDefinition(imageModel).supports.aspectRatios}
          supportedImageSizes={getImageModelDefinition(imageModel).supports.imageSizes}
          cameraAngle={cameraAngle}
          cameraLens={cameraLens}
          referenceDocuments={referenceDocuments}
          onGenerate={handleGenerate}
          onAdditionalPromptChange={setAdditionalPrompt}
          onAspectRatioChange={setAspectRatio}
          onImageSizeChange={setImageSize}
          onUseReferenceImagesChange={setUseReferenceImages}
          onPixelArtGridChange={setPixelArtGrid}
          onShowAdvancedChange={setShowAdvanced}
          onShowHelpChange={setShowHelp}
          onSeedChange={setSeed}
          onTemperatureChange={setTemperature}
          onTopKChange={setTopK}
          onTopPChange={setTopP}
          onImageModelChange={setImageModel}
          onImageQualityChange={setImageQuality}
          onCameraAngleChange={setCameraAngle}
          onCameraLensChange={setCameraLens}
          onDocumentAdd={onDocumentAdd}
          onDocumentDelete={onDocumentDelete}
        />


      {/* 오른쪽: 결과 표시 및 히스토리 */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* 결과 표시 영역 */}
          <GeneratorPreview
            isGenerating={isGenerating}
            progressMessage={progressMessage}
            generatedImage={generatedImage}
            zoomLevel={zoomLevel}
            onManualSave={handleManualSave}
          />

          {/* 히스토리 섹션 */}
          <GeneratorHistory
            generationHistory={generationHistory}
            historyHeight={historyHeight}
            onHistoryResize={handleHistoryResize}
            onRestoreFromHistory={handleRestoreFromHistory}
            onTogglePin={handleTogglePin}
            onDeleteHistory={onHistoryDelete}
          />

        </div>
      </div>


      {/* 도움말 팝업 */}
      {showHelp && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white border border-gray-200 rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[80vh] overflow-y-auto">
            {/* 헤더 */}
            <div className="sticky top-0 bg-white border-b border-gray-200 p-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <HelpCircle size={24} className="text-purple-600" />
                <h3 className="text-lg font-semibold">고급 설정 도움말</h3>
              </div>
              <button
                onClick={() => setShowHelp(false)}
                className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <X size={20} />
              </button>
            </div>

            {/* 내용 */}
            <div className="p-6 space-y-6">
              {/* Seed */}
              <div>
                <h4 className="text-base font-semibold text-gray-800 mb-2 flex items-center gap-2">
                  <span className="px-2 py-1 bg-purple-100 text-purple-700 rounded text-sm">Seed</span>
                  <span>재현성 제어</span>
                </h4>
                <p className="text-sm text-gray-700 leading-relaxed mb-2">
                  동일한 Seed 값을 사용하면 같은 설정에서 동일한 결과를 재현할 수 있습니다.
                </p>
                <ul className="text-sm text-gray-600 space-y-1 ml-4">
                  <li>• <strong>값 지정:</strong> 특정 결과를 재현하고 싶을 때 사용</li>
                  <li>• <strong>비워두기:</strong> 매번 다른 랜덤 결과 생성</li>
                  <li>• <strong>팁:</strong> 좋은 결과가 나온 Seed 값을 저장해두면 유용합니다</li>
                </ul>
              </div>

              {/* Temperature */}
              <div>
                <h4 className="text-base font-semibold text-gray-800 mb-2 flex items-center gap-2">
                  <span className="px-2 py-1 bg-blue-100 text-blue-700 rounded text-sm">Temperature</span>
                  <span>창의성 vs 일관성</span>
                </h4>
                <p className="text-sm text-gray-700 leading-relaxed mb-2">
                  이미지 생성 시 AI의 창의성 정도를 조절합니다.
                </p>
                <ul className="text-sm text-gray-600 space-y-1 ml-4">
                  <li>• <strong>낮은 값 (0.0~0.8):</strong> 일관적이고 예측 가능한 결과, 참조 이미지에 가까움</li>
                  <li>• <strong>중간 값 (0.8~1.2):</strong> 균형잡힌 창의성과 일관성</li>
                  <li>• <strong>높은 값 (1.2~2.0):</strong> 창의적이고 다양한 결과, 예측 불가능</li>
                  <li>• <strong>권장:</strong> 캐릭터 유지는 0.8, 새로운 디자인은 1.2</li>
                </ul>
              </div>

              {/* Top-K */}
              <div>
                <h4 className="text-base font-semibold text-gray-800 mb-2 flex items-center gap-2">
                  <span className="px-2 py-1 bg-green-100 text-green-700 rounded text-sm">Top-K</span>
                  <span>샘플링 범위</span>
                </h4>
                <p className="text-sm text-gray-700 leading-relaxed mb-2">
                  AI가 선택할 수 있는 상위 토큰의 개수를 제한합니다.
                </p>
                <ul className="text-sm text-gray-600 space-y-1 ml-4">
                  <li>• <strong>낮은 값 (1~30):</strong> 가장 확실한 선택만, 보수적이고 안전한 결과</li>
                  <li>• <strong>중간 값 (30~60):</strong> 적절한 다양성 유지</li>
                  <li>• <strong>높은 값 (60~100):</strong> 더 많은 선택지, 다양하고 실험적인 결과</li>
                  <li>• <strong>권장:</strong> 일반적으로 40이 적절, 다양성 원하면 60</li>
                </ul>
              </div>

              {/* Top-P */}
              <div>
                <h4 className="text-base font-semibold text-gray-800 mb-2 flex items-center gap-2">
                  <span className="px-2 py-1 bg-orange-100 text-orange-700 rounded text-sm">Top-P</span>
                  <span>누적 확률 임계값</span>
                </h4>
                <p className="text-sm text-gray-700 leading-relaxed mb-2">
                  누적 확률이 이 값에 도달할 때까지의 토큰만 고려합니다 (Nucleus Sampling).
                </p>
                <ul className="text-sm text-gray-600 space-y-1 ml-4">
                  <li>• <strong>낮은 값 (0.5~0.8):</strong> 가장 확실한 선택만, 일관된 결과</li>
                  <li>• <strong>중간 값 (0.8~0.95):</strong> 균형잡힌 다양성</li>
                  <li>• <strong>높은 값 (0.95~1.0):</strong> 거의 모든 선택지 고려, 매우 다양한 결과</li>
                  <li>• <strong>권장:</strong> 0.95가 적절, Top-K와 함께 사용하면 효과적</li>
                </ul>
              </div>

              {/* Reference Strength */}
              <div>
                <h4 className="text-base font-semibold text-gray-800 mb-2 flex items-center gap-2">
                  <span className="px-2 py-1 bg-pink-100 text-pink-700 rounded text-sm">Reference Strength</span>
                  <span>참조 영향력</span>
                </h4>
                <p className="text-sm text-gray-700 leading-relaxed mb-2">
                  참조 이미지가 생성 결과에 미치는 영향력을 조절합니다.
                </p>
                <ul className="text-sm text-gray-600 space-y-1 ml-4">
                  <li>• <strong>낮은 값 (0.0~0.5):</strong> 영감만 받음, 자유로운 해석</li>
                  <li>• <strong>중간 값 (0.5~0.8):</strong> 스타일이나 구도만 유지</li>
                  <li>• <strong>높은 값 (0.8~1.0):</strong> 참조 이미지와 매우 유사하게</li>
                  <li>• <strong>권장:</strong> 캐릭터 유지는 0.95, 스타일만 0.6, 변형은 0.85</li>
                </ul>
              </div>

              {/* 프리셋 설명 */}
              <div className="bg-gradient-to-r from-purple-50 to-blue-50 rounded-lg p-4 border border-purple-200">
                <h4 className="text-base font-semibold text-gray-800 mb-3">💡 프리셋 활용 팁</h4>
                <div className="space-y-2 text-sm text-gray-700">
                  <p><strong>🎭 포즈/표정/동작 베리에이션:</strong> Reference Strength 0.95, Temperature 0.8 → 캐릭터 외형은 그대로 유지하면서 포즈만 변경</p>
                  <p><strong>👥 다양한 캐릭터 디자인:</strong> Reference Strength 0.6, Temperature 1.2 → 스타일은 유지하되 완전히 새로운 캐릭터 생성</p>
                  <p><strong>👗 헤어/의상/악세사리 변경:</strong> Reference Strength 0.85, Temperature 1.0 → 캐릭터의 기본 외형은 유지하면서 스타일 요소만 변경</p>
                </div>
              </div>

              {/* Negative Prompt 안내 */}
              <div className="bg-yellow-50 rounded-lg p-4 border border-yellow-200">
                <h4 className="text-base font-semibold text-gray-800 mb-2 flex items-center gap-2">
                  ⚠️ Negative Prompt 설정
                </h4>
                <p className="text-sm text-gray-700">
                  Negative Prompt는 이미지 분석 패널의 "부정 프롬프트 카드"에서만 수정할 수 있습니다.
                  이는 일관된 품질을 유지하기 위해 고정된 값을 사용하도록 설계되었습니다.
                </p>
              </div>
            </div>

            {/* 푸터 */}
            <div className="sticky bottom-0 bg-white border-t border-gray-200 p-4">
              <button
                onClick={() => setShowHelp(false)}
                className="w-full px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-700 text-white transition-colors font-medium"
              >
                닫기
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
