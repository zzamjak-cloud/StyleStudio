// OpenRouter 통합 API 클라이언트
// - 텍스트/비전: POST /api/v1/chat/completions (OpenAI 호환)
// - 이미지 생성: POST /api/v1/images (전용 Image API, input_references 지원)
// 회사 정책에 따라 Gemini/OpenAI 개별 키 대신 OpenRouter 통합 키 하나만 사용한다.

import { logger } from '../logger';

export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

// 앱 식별용 선택 헤더 (openrouter.ai 대시보드에서 앱 단위 사용량 추적)
const APP_TITLE = 'StyleStudio';

export function openrouterHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey.trim()}`,
    'Content-Type': 'application/json',
    'X-OpenRouter-Title': APP_TITLE,
  };
}

// ---------------------------------------------------------------------------
// Chat Completions (텍스트 생성 · 비전 분석)
// ---------------------------------------------------------------------------

interface ChatTextPart {
  type: 'text';
  text: string;
}

interface ChatImagePart {
  type: 'image_url';
  image_url: { url: string };
}

export type ChatContentPart = ChatTextPart | ChatImagePart;

export interface ChatMessageInput {
  role: 'system' | 'user' | 'assistant';
  content: string | ChatContentPart[];
}

interface ChatCompleteParams {
  model: string;
  messages: ChatMessageInput[];
  maxTokens?: number;
}

/** data URL을 chat completions image_url 파트로 변환 */
export function toImagePart(imageDataUrlOrBase64: string): ChatImagePart {
  const url = imageDataUrlOrBase64.startsWith('data:')
    ? imageDataUrlOrBase64
    : `data:image/png;base64,${imageDataUrlOrBase64}`;
  return { type: 'image_url', image_url: { url } };
}

/**
 * 텍스트 응답을 반환하는 chat completions 호출.
 * finish_reason이 length/content_filter면 상황을 알 수 있는 에러를 던진다.
 */
export async function chatComplete(apiKey: string, params: ChatCompleteParams): Promise<string> {
  const cleanApiKey = String(apiKey || '').trim();
  if (!cleanApiKey) {
    throw new Error('API Key가 비어있습니다');
  }

  const body: Record<string, unknown> = {
    model: params.model,
    messages: params.messages,
  };
  if (params.maxTokens !== undefined) {
    body.max_tokens = params.maxTokens;
  }

  const response = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: openrouterHeaders(cleanApiKey),
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    logger.error('❌ OpenRouter API 오류:', response.status, errorText);
    throw new Error(`API 오류 (${response.status}): ${errorText}`);
  }

  const result = await response.json();
  const choice = result?.choices?.[0];

  if (!choice) {
    throw new Error('OpenRouter 응답에 choices가 없습니다. API 키나 요청을 확인하세요.');
  }

  const finishReason: string | undefined = choice.finish_reason;
  const text: string = typeof choice.message?.content === 'string' ? choice.message.content : '';

  if (finishReason === 'content_filter') {
    throw new Error('요청이 콘텐츠 필터에 의해 차단되었습니다. 다른 이미지나 프롬프트로 시도해주세요.');
  }
  if (!text && finishReason === 'length') {
    throw new Error('응답이 너무 길어서 잘렸습니다. 입력을 줄이거나 다시 시도해주세요.');
  }
  if (!text) {
    throw new Error('OpenRouter 응답에 텍스트가 없습니다. 다시 시도해주세요.');
  }

  return text;
}

// ---------------------------------------------------------------------------
// Image API (이미지 생성)
// ---------------------------------------------------------------------------

export interface ImageApiRequest {
  model: string;
  prompt: string;
  /** '1:1' | '16:9' | '9:16' | '4:3' | '3:4' 등 */
  aspectRatio?: string;
  /** '1K' | '2K' | '4K' — Gemini 계열 전용 */
  resolution?: string;
  /** 'low' | 'medium' | 'high' — gpt-image 계열 전용 */
  quality?: string;
  /** 참조 이미지 data URL 배열 */
  inputReferences?: string[];
}

export interface GeneratedImage {
  base64: string;
  mediaType: string;
}

/**
 * OpenRouter Image API 호출. base64 이미지와 media_type을 반환한다.
 * 파라미터는 모델별 supported_parameters에 맞는 것만 전달할 것
 * (미지원 파라미터는 400 원인이 될 수 있다).
 */
export async function generateImageViaOpenRouter(
  apiKey: string,
  request: ImageApiRequest
): Promise<GeneratedImage> {
  const cleanApiKey = String(apiKey || '').trim();
  if (!cleanApiKey) {
    throw new Error('API Key가 비어있습니다');
  }

  const body: Record<string, unknown> = {
    model: request.model,
    prompt: request.prompt,
  };
  if (request.aspectRatio) body.aspect_ratio = request.aspectRatio;
  if (request.resolution) body.resolution = request.resolution;
  if (request.quality) body.quality = request.quality;
  if (request.inputReferences && request.inputReferences.length > 0) {
    body.input_references = request.inputReferences.map((img) => ({
      type: 'image_url',
      image_url: {
        url: img.startsWith('data:') ? img : `data:image/png;base64,${img}`,
      },
    }));
  }

  const response = await fetch(`${OPENROUTER_BASE_URL}/images`, {
    method: 'POST',
    headers: openrouterHeaders(cleanApiKey),
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    logger.error('❌ OpenRouter Image API 오류:', response.status, errorText);
    throw new Error(`API 오류 (${response.status}): ${errorText}`);
  }

  const result = await response.json();
  const first = result?.data?.[0];
  const b64 = first?.b64_json;

  if (typeof b64 !== 'string' || b64.length === 0) {
    throw new Error('OpenRouter 응답에서 이미지 데이터를 찾을 수 없습니다 (b64_json)');
  }

  return {
    base64: b64,
    mediaType: typeof first.media_type === 'string' ? first.media_type : 'image/png',
  };
}
