import { ImageGenerationModel } from '../hooks/api/imageModels';
import { ImageQualityOption } from '../hooks/api/imageModels';
import { PixelArtGridLayout } from './pixelart';
import { ReferenceDocument } from './referenceDocument';

// 개별 채팅 메시지
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'summary';
  content: string;
  images?: string[];
  timestamp: string;
  documents?: ReferenceDocument[]; // v0.4.4: 첨부 문서
  isGeneratedImage?: boolean;
  tokenCount?: number;
  imageSignatures?: string[]; // AI 생성 이미지의 thought_signature (images 배열과 1:1 대응)
}

// 채팅 세션 데이터
export interface ChatSessionData {
  messages: ChatMessage[];
  attachedDocuments?: ReferenceDocument[]; // 채팅 입력창에 현재 첨부된 문서 목록
  summary?: string;
  summarizedUpTo?: number;
  totalTokenCount: number;
  settings: ChatGenerationSettings;
}

// 채팅 전용 간소화 설정
export interface ChatGenerationSettings {
  aspectRatio: '1:1' | '16:9' | '9:16' | '4:3' | '3:4' | '1:3' | '3:1';
  imageModel: ImageGenerationModel;
  imageSize: '1K' | '2K' | '4K';
  imageQuality?: ImageQualityOption;
  pixelArtGrid: PixelArtGridLayout;
  stylePreset?: string;
  customStyle?: string;
  thinkingMode?: boolean; // GPT-Image-2 / Gemini 추론 기반 생성 prefix 적용 여부 (베타)
}

// 토큰 수 추정 (한국어 ~2자/토큰, 이미지 ~258토큰)
export function estimateTokenCount(message: ChatMessage): number {
  let tokens = 0;
  if (message.content) {
    tokens += Math.ceil(message.content.length / 2);
  }
  if (message.images) {
    tokens += message.images.length * 258;
  }
  if (message.documents) {
    for (const doc of message.documents) {
      if (doc.content) tokens += Math.ceil(doc.content.length / 2);
      if (doc.extractedImages) tokens += doc.extractedImages.length * 258;
    }
  }
  return tokens;
}
