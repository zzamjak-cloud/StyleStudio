import { useState, useCallback, useEffect, useRef } from 'react';
import { Plus, Users, Pencil, Check, Trash2 } from 'lucide-react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { readFile } from '@tauri-apps/plugin-fs';
import { CharacterCard } from './CharacterCard';
import { BackgroundSection } from './BackgroundSection';
import { ConceptSketchPanel } from './conceptSketch/ConceptSketchPanel';
import { IllustrationSessionData, IllustrationCharacter, ILLUSTRATION_LIMITS, ConceptSketch } from '../../types/illustration';
import { logger } from '../../lib/logger';

// 드롭 타겟 타입
type DropTargetType = { type: 'character'; id: string } | { type: 'background' } | null;

// 드롭 영역 정보
interface DropZoneInfo {
  type: 'character' | 'background';
  id?: string;
  element: HTMLElement;
}

interface IllustrationSetupPanelProps {
  data: IllustrationSessionData;
  onDataChange: (data: IllustrationSessionData) => void;
  disabled?: boolean;
  geminiApiKey?: string;
}

export function IllustrationSetupPanel({
  data,
  onDataChange,
  disabled = false,
  geminiApiKey = '',
}: IllustrationSetupPanelProps) {
  // 구도 스케치 모달 상태
  const [sketchOpen, setSketchOpen] = useState(false);

  const handleSketchSave = useCallback(
    (sketch: ConceptSketch) => {
      onDataChange({ ...data, conceptSketch: sketch });
    },
    [data, onDataChange]
  );

  const handleSketchClear = useCallback(() => {
    if (!confirm('등록된 구도 스케치를 삭제하시겠습니까?')) return;
    const next = { ...data };
    delete next.conceptSketch;
    onDataChange(next);
  }, [data, onDataChange]);

  // 드래그앤드롭 상태
  const [isDragging, setIsDragging] = useState(false);
  const [activeDropTarget, setActiveDropTarget] = useState<DropTargetType>(null);

  // 등록된 드롭 영역들
  const dropZonesRef = useRef<Map<string, DropZoneInfo>>(new Map());

  // 최신 상태 참조를 위한 ref
  const dataRef = useRef(data);
  const onDataChangeRef = useRef(onDataChange);
  const activeDropTargetRef = useRef(activeDropTarget);
  const disabledRef = useRef(disabled);

  useEffect(() => {
    dataRef.current = data;
    onDataChangeRef.current = onDataChange;
    activeDropTargetRef.current = activeDropTarget;
    disabledRef.current = disabled;
  }, [data, onDataChange, activeDropTarget, disabled]);

  // 드롭 영역 등록
  const registerDropZone = useCallback((id: string, info: DropZoneInfo) => {
    dropZonesRef.current.set(id, info);
  }, []);

  // 드롭 영역 해제
  const unregisterDropZone = useCallback((id: string) => {
    dropZonesRef.current.delete(id);
  }, []);

  // 위치 기반으로 드롭 타겟 찾기
  const findDropTargetAtPosition = useCallback((x: number, y: number): DropTargetType => {
    for (const [, info] of dropZonesRef.current) {
      const rect = info.element.getBoundingClientRect();
      if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
        if (info.type === 'character' && info.id) {
          return { type: 'character', id: info.id };
        } else if (info.type === 'background') {
          return { type: 'background' };
        }
      }
    }
    return null;
  }, []);

  // 파일 경로가 이미지인지 확인
  const isImageFile = useCallback((filePath: string): boolean => {
    const ext = filePath.split('.').pop()?.toLowerCase();
    return ext ? ['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext) : false;
  }, []);

  // 투명 배경을 흰색으로 변환
  const convertTransparentToWhite = useCallback((dataUrl: string): Promise<string> => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Canvas context를 가져올 수 없습니다'));
          return;
        }
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0);
        resolve(canvas.toDataURL('image/png'));
      };
      img.onerror = () => reject(new Error('이미지 로드 실패'));
      img.src = dataUrl;
    });
  }, []);

  // 전역 드래그앤드롭 리스너 (단일)
  useEffect(() => {
    let unlisten: (() => void | Promise<void>) | undefined;
    let isDisposed = false;
    let isUnlistenCalled = false;

    const safeUnlisten = (dispose?: () => void | Promise<void>) => {
      if (!dispose || isUnlistenCalled) return;
      isUnlistenCalled = true;
      try {
        Promise.resolve(dispose()).catch((error) => {
          logger.warn('Illustration 드래그 리스너 비동기 해제 중 경고:', error);
        });
      } catch (error) {
        logger.warn('Illustration 드래그 리스너 해제 중 경고:', error);
      }
    };

    const setup = async () => {
      try {
        const appWindow = getCurrentWindow();

        const dispose = await appWindow.onDragDropEvent(async (event) => {
          if (event.payload.type === 'enter') {
            setIsDragging(true);
            setActiveDropTarget(null);
          } else if (event.payload.type === 'over') {
            setIsDragging(true);
            const position = event.payload.position;
            if (position) {
              const target = findDropTargetAtPosition(position.x, position.y);
              setActiveDropTarget(target);
              activeDropTargetRef.current = target;
            }
          } else if (event.payload.type === 'leave') {
            setIsDragging(false);
            setActiveDropTarget(null);
          } else if (event.payload.type === 'drop') {
            setIsDragging(false);

            const position = event.payload.position;
            let target = activeDropTargetRef.current;
            if (position) {
              target = findDropTargetAtPosition(position.x, position.y);
            }

            setActiveDropTarget(null);

            if (!target) return;
            if (disabledRef.current) return;

            const filePaths = event.payload.paths;
            if (!filePaths || filePaths.length === 0) return;

            const imageFiles = filePaths.filter(isImageFile);
            if (imageFiles.length === 0) return;

            const currentData = dataRef.current;

            if (target.type === 'character') {
              const character = currentData.characters.find(c => c.id === target.id);
              if (!character) return;

              const remainingSlots = ILLUSTRATION_LIMITS.MAX_IMAGES_PER_CHARACTER - character.images.length;
              if (remainingSlots <= 0) return;

              const filesToProcess = imageFiles.slice(0, remainingSlots);
              const newImages: string[] = [];

              for (const filePath of filesToProcess) {
                try {
                  const fileData = await readFile(filePath);
                  const base64 = btoa(
                    Array.from(new Uint8Array(fileData))
                      .map((b) => String.fromCharCode(b))
                      .join('')
                  );
                  const ext = filePath.split('.').pop()?.toLowerCase();
                  const mimeType = ext === 'png' ? 'image/png' :
                                  ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' :
                                  ext === 'gif' ? 'image/gif' :
                                  ext === 'webp' ? 'image/webp' : 'image/png';
                  const dataUrl = `data:${mimeType};base64,${base64}`;
                  const convertedImage = await convertTransparentToWhite(dataUrl);
                  newImages.push(convertedImage);
                } catch (error) {
                  logger.error('이미지 로드 실패:', filePath, error);
                }
              }

              if (newImages.length > 0) {
                onDataChangeRef.current({
                  ...currentData,
                  characters: currentData.characters.map(c =>
                    c.id === target.id
                      ? { ...c, images: [...c.images, ...newImages] }
                      : c
                  ),
                });
                logger.debug(`✅ ${character.name}에 ${newImages.length}장 이미지 추가됨`);
              }
            } else if (target.type === 'background') {
              const remainingSlots = ILLUSTRATION_LIMITS.MAX_BACKGROUND_IMAGES - currentData.backgroundImages.length;
              if (remainingSlots <= 0) return;

              const filesToProcess = imageFiles.slice(0, remainingSlots);
              const newImages: string[] = [];

              for (const filePath of filesToProcess) {
                try {
                  const fileData = await readFile(filePath);
                  const base64 = btoa(
                    Array.from(new Uint8Array(fileData))
                      .map((b) => String.fromCharCode(b))
                      .join('')
                  );
                  const ext = filePath.split('.').pop()?.toLowerCase();
                  const mimeType = ext === 'png' ? 'image/png' :
                                  ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' :
                                  ext === 'gif' ? 'image/gif' :
                                  ext === 'webp' ? 'image/webp' : 'image/png';
                  const dataUrl = `data:${mimeType};base64,${base64}`;
                  const convertedImage = await convertTransparentToWhite(dataUrl);
                  newImages.push(convertedImage);
                } catch (error) {
                  logger.error('이미지 로드 실패:', filePath, error);
                }
              }

              if (newImages.length > 0) {
                onDataChangeRef.current({
                  ...currentData,
                  backgroundImages: [...currentData.backgroundImages, ...newImages],
                });
                logger.debug(`✅ 배경에 ${newImages.length}장 이미지 추가됨`);
              }
            }
          }
        });

        if (isDisposed) {
          safeUnlisten(dispose);
          return;
        }
        unlisten = dispose;

        logger.debug('✅ [IllustrationSetupPanel] 전역 드래그 리스너 등록');
      } catch (error) {
        logger.error('전역 드래그 리스너 등록 실패:', error);
      }
    };

    setup();
    return () => {
      isDisposed = true;
      safeUnlisten(unlisten);
    };
  }, [isImageFile, convertTransparentToWhite, findDropTargetAtPosition]);

  // 캐릭터 추가
  const handleAddCharacter = () => {
    if (disabled || data.characters.length >= ILLUSTRATION_LIMITS.MAX_CHARACTERS) return;

    const existingNames = data.characters.map(c => c.name);
    let baseName = '새 캐릭터';
    let counter = 1;
    let newName = baseName;
    while (existingNames.includes(newName)) {
      newName = `${baseName} ${counter}`;
      counter++;
    }

    const newCharacter: IllustrationCharacter = {
      id: `char-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
      name: newName,
      images: [],
    };

    onDataChange({
      ...data,
      characters: [...data.characters, newCharacter],
    });
  };

  // 캐릭터 업데이트
  const handleUpdateCharacter = (updatedCharacter: IllustrationCharacter) => {
    onDataChange({
      ...data,
      characters: data.characters.map(c =>
        c.id === updatedCharacter.id ? updatedCharacter : c
      ),
    });
  };

  // 캐릭터 삭제
  const handleDeleteCharacter = (characterId: string) => {
    onDataChange({
      ...data,
      characters: data.characters.filter(c => c.id !== characterId),
    });
  };

  // 배경 이미지 변경
  const handleBackgroundImagesChange = (images: string[]) => {
    onDataChange({
      ...data,
      backgroundImages: images,
    });
  };

  const canAddCharacter = data.characters.length < ILLUSTRATION_LIMITS.MAX_CHARACTERS;
  const hasCharactersWithImages = data.characters.some(c => c.images.length > 0);

  return (
    <div className="space-y-4">
      {/* 캐릭터 섹션 */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Users size={18} className="text-violet-600" />
            <span className="text-sm font-semibold text-gray-800">
              캐릭터 ({data.characters.length}/{ILLUSTRATION_LIMITS.MAX_CHARACTERS})
            </span>
          </div>
          <button
            onClick={handleAddCharacter}
            disabled={disabled || !canAddCharacter}
            className={`flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
              canAddCharacter
                ? 'bg-violet-600 hover:bg-violet-700 text-white shadow-sm'
                : 'bg-gray-100 text-gray-400 cursor-not-allowed'
            }`}
          >
            <Plus size={14} />
            캐릭터 추가
          </button>
        </div>

        {/* 캐릭터가 없을 때 안내 */}
        {data.characters.length === 0 ? (
          <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center bg-gray-50">
            <Users size={32} className="mx-auto mb-2 text-gray-400" />
            <p className="text-sm text-gray-600 font-medium">캐릭터를 추가하여 시작하세요</p>
            <p className="text-xs text-gray-400 mt-1">
              각 캐릭터에 이름을 지정하고 참조 이미지를 등록합니다
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {data.characters.map((character) => (
              <CharacterCard
                key={character.id}
                character={character}
                onUpdate={handleUpdateCharacter}
                onDelete={() => handleDeleteCharacter(character.id)}
                disabled={disabled}
                isDragging={isDragging}
                isDropTarget={activeDropTarget?.type === 'character' && activeDropTarget.id === character.id}
                registerDropZone={registerDropZone}
                unregisterDropZone={unregisterDropZone}
              />
            ))}
          </div>
        )}
      </div>

      {/* 배경 섹션 */}
      <BackgroundSection
        images={data.backgroundImages}
        onImagesChange={handleBackgroundImagesChange}
        disabled={disabled}
        isDragging={isDragging}
        isDropTarget={activeDropTarget?.type === 'background'}
        registerDropZone={registerDropZone}
        unregisterDropZone={unregisterDropZone}
      />

      {/* 구도 스케치 섹션 (Phase 4) */}
      <div className="border-t border-gray-200 pt-4">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Pencil className="w-4 h-4 text-purple-600" />
            <h3 className="text-sm font-semibold text-gray-800">구도 스케치 (선택)</h3>
            {data.conceptSketch && (
              <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-green-100 text-green-700">
                <Check size={10} /> 등록됨
              </span>
            )}
            {data.conceptSketch?.analysis && (
              <span className="text-[11px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">
                AI 분석 완료
              </span>
            )}
          </div>
          <div className="flex gap-1">
            {data.conceptSketch && (
              <button
                onClick={handleSketchClear}
                disabled={disabled}
                className="flex items-center gap-1 text-xs px-2 py-1 bg-white border border-gray-300 rounded hover:bg-red-50 hover:border-red-300 text-gray-700 hover:text-red-600 disabled:opacity-50"
                title="스케치 삭제"
              >
                <Trash2 size={12} /> 삭제
              </button>
            )}
            <button
              onClick={() => setSketchOpen(true)}
              disabled={disabled}
              className="flex items-center gap-1 text-xs px-3 py-1.5 bg-purple-600 hover:bg-purple-700 text-white rounded font-medium disabled:opacity-50"
            >
              <Pencil size={12} />
              {data.conceptSketch ? '편집' : '구도 스케치 그리기'}
            </button>
          </div>
        </div>
        <p className="text-[11px] text-gray-500 leading-relaxed">
          캔버스에 거친 도형으로 인물 위치를 잡고 캐릭터 이름 라벨을 배치하면, AI가 분석하여 layout/perspective/placements를 추출하고 최종 이미지 생성에 반영합니다.
        </p>
        {data.conceptSketch && (
          <div className="mt-2 flex gap-3 items-start">
            <img
              src={data.conceptSketch.sketchPng}
              alt="구도 스케치 미리보기"
              className="w-32 h-20 object-contain border border-gray-300 rounded bg-white"
            />
            {data.conceptSketch.analysis && (
              <div className="flex-1 text-[11px] text-gray-600">
                <p>📐 <span className="font-medium">{data.conceptSketch.analysis.layout}</span></p>
                <p>📷 {data.conceptSketch.analysis.perspective} · {data.conceptSketch.analysis.cameraDistance}</p>
                {data.conceptSketch.analysis.placements.length > 0 && (
                  <p>👥 {data.conceptSketch.analysis.placements.length}개 캐릭터 배치 인식</p>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* 준비 완료 상태 */}
      {hasCharactersWithImages && (
        <div className="border-t border-gray-200 pt-4">
          <div className="flex items-center gap-2 text-green-600">
            <span className="text-sm font-semibold">✓ 이미지 생성 준비 완료</span>
          </div>
          <p className="text-xs text-gray-500 mt-1">
            프롬프트를 입력하고 이미지 생성 버튼을 클릭하세요
          </p>
        </div>
      )}

      {/* 구도 스케치 모달 */}
      <ConceptSketchPanel
        open={sketchOpen}
        geminiApiKey={geminiApiKey}
        characters={data.characters}
        initial={data.conceptSketch}
        onClose={() => setSketchOpen(false)}
        onSave={handleSketchSave}
      />
    </div>
  );
}
