import { ImageAnalysisResult } from './analysis';
import { PixelArtGridLayout } from './pixelart';
import { ReferenceDocument } from './referenceDocument';
import { IllustrationSessionData } from './illustration';
import { ChatSessionData } from './chat';
import { ConceptSessionData } from './concept';
export type SessionType = 'BASIC' | 'STYLE' | 'CHARACTER' | 'BACKGROUND' | 'ICON' | 'PIXELART_CHARACTER' | 'PIXELART_BACKGROUND' | 'PIXELART_ICON' | 'UI' | 'LOGO' | 'ILLUSTRATION' | 'CONCEPT';

export interface Session {
  id: string;
  name: string;
  type: SessionType;
  createdAt: string;
  updatedAt: string;
  referenceImages: string[]; // Base64 data URL 배열 (레거시) 또는 IndexedDB 키 배열 (신규)
  imageKeys?: string[]; // IndexedDB 키 배열 (신규 방식, 있으면 우선 사용)
  analysis: ImageAnalysisResult;
  imageCount: number; // 참조 이미지 개수
  generationHistory?: GenerationHistoryEntry[]; // 생성 히스토리 (선택)
  /** @deprecated v0.4.4 이후 사용 안 함. 저장 경로는 자동으로 ~/Downloads/AI_Gen/{세션명}/ */
  autoSavePath?: string;
  referenceDocuments?: ReferenceDocument[]; // 참조 문서 (UI 세션 전용)
  folderId?: string | null; // 소속 폴더 ID (null/undefined면 루트)
  illustrationData?: IllustrationSessionData; // 일러스트 세션 전용 데이터
  chatData?: ChatSessionData; // BASIC 채팅 세션 전용 데이터
  conceptData?: ConceptSessionData; // CONCEPT 세션 전용 데이터
}

// 생성 히스토리 엔트리
export interface GenerationHistoryEntry {
  id: string; // UUID
  timestamp: string; // ISO 8601
  prompt: string; // 사용된 프롬프트
  negativePrompt?: string; // 사용된 네거티브 프롬프트
  additionalPrompt?: string; // 추가 포즈/동작 프롬프트 (원본 한글 또는 영어)
  imageBase64: string; // 생성된 이미지 (Base64)
  settings: GenerationSettings; // 사용된 설정
  isPinned?: boolean; // 즐겨찾기 표시
  referenceDocumentIds?: string[]; // 참조 문서 ID 목록 (UI 세션 전용)
}

// 생성 설정
export interface GenerationSettings {
  aspectRatio: '1:1' | '16:9' | '9:16' | '4:3' | '3:4' | '1:3' | '3:1';
  imageSize: '1K' | '2K' | '4K';
  seed?: number;
  temperature?: number;
  topK?: number;
  topP?: number;
  referenceStrength?: number; // 참조 이미지 영향력 (0.0 ~ 1.0)
  useReferenceImages: boolean;
  pixelArtGrid?: PixelArtGridLayout; // 스프라이트 그리드 레이아웃 (1x1, 2x2, 4x4, 6x6, 8x8)
  cameraAngle?: string; // 카메라 앵글 프리셋 ID
  cameraLens?: string;  // 카메라 렌즈/화각 프리셋 ID
  thinkingMode?: boolean; // GPT-Image-2 / Gemini 추론 기반 생성 prefix 적용 여부 (베타)
}
