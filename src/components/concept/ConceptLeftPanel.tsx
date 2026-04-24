import { useState, useCallback, useEffect, useRef, memo } from 'react';
import { Upload, X, Plus, Trash2, Image, Gamepad2, Palette } from 'lucide-react';
import { GAME_GENRE_PRESETS, ART_STYLE_PRESETS } from '../../types/concept';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { readFile } from '@tauri-apps/plugin-fs';
import { open } from '@tauri-apps/plugin-dialog';
import { useImagePaste } from '../../hooks/useImagePaste';
import { LazyImage } from '../common/LazyImage';

// localStorage 키
const CUSTOM_GENRES_KEY = 'stylestudio-custom-genres';
const CUSTOM_STYLES_KEY = 'stylestudio-custom-styles';

// localStorage에서 커스텀 항목 로드
function loadCustomItems(key: string): string[] {
  try {
    const stored = localStorage.getItem(key);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

// localStorage에 커스텀 항목 저장
function saveCustomItems(key: string, items: string[]) {
  localStorage.setItem(key, JSON.stringify(items));
}

interface ConceptLeftPanelProps {
  referenceImage?: string;
  generatedImage?: string;
  gameGenres: string[];
  gamePlayStyle?: string;
  referenceGames?: string[];
  artStyles: string[];
  onReferenceImageChange: (image: string | undefined) => void;
  onGamePlayStyleDraftChange: (value: string) => void;
  onGameInfoChange: (gameInfo: {
    gameGenres: string[];
    gamePlayStyle?: string;
    referenceGames?: string[];
    artStyles: string[];
  }) => void;
}

/** 커스텀 항목 추가 팝업 */
function CustomInputPopup({
  title,
  placeholder,
  onSave,
  onClose,
}: {
  title: string;
  placeholder: string;
  onSave: (value: string) => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSave = () => {
    const trimmed = value.trim();
    if (trimmed) {
      onSave(trimmed);
      onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-2xl w-80 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-gray-200">
          <h4 className="font-semibold text-gray-800">{title}</h4>
        </div>
        <div className="p-4 space-y-3">
          <input
            ref={inputRef}
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSave();
              if (e.key === 'Escape') onClose();
            }}
            placeholder={placeholder}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
          />
          <div className="flex gap-2 justify-end">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
            >
              취소
            </button>
            <button
              onClick={handleSave}
              disabled={!value.trim()}
              className="px-4 py-2 text-sm bg-purple-500 text-white rounded-lg hover:bg-purple-600 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
            >
              저장
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** 컨셉 세션 좌측 입력 패널 */
export const ConceptLeftPanel = memo(({
  referenceImage,
  generatedImage,
  gameGenres,
  gamePlayStyle,
  referenceGames,
  artStyles,
  onReferenceImageChange,
  onGamePlayStyleDraftChange,
  onGameInfoChange,
}: ConceptLeftPanelProps) => {
  const [referenceGameInput, setReferenceGameInput] = useState('');
  const [localReferenceGames, setLocalReferenceGames] = useState<string[]>(referenceGames || []);
  const [previewImage, setPreviewImage] = useState<{ src: string; title: string } | null>(null);
  const playStyleRef = useRef<HTMLTextAreaElement>(null);

  // 커스텀 장르/스타일 (localStorage 기반)
  const [customGenres, setCustomGenres] = useState<string[]>(() => loadCustomItems(CUSTOM_GENRES_KEY));
  const [customStyles, setCustomStyles] = useState<string[]>(() => loadCustomItems(CUSTOM_STYLES_KEY));

  // 팝업 상태
  const [showGenrePopup, setShowGenrePopup] = useState(false);
  const [showStylePopup, setShowStylePopup] = useState(false);

  // 세션 전환 시 게임 플레이 입력값 동기화
  useEffect(() => {
    if (playStyleRef.current) {
      playStyleRef.current.value = gamePlayStyle || '';
    }
  }, [gamePlayStyle]);

  useEffect(() => {
    setLocalReferenceGames(referenceGames || []);
  }, [referenceGames]);

  // onReferenceImageChange를 안정적인 참조로 저장
  const imageChangeRef = useRef(onReferenceImageChange);
  useEffect(() => {
    imageChangeRef.current = onReferenceImageChange;
  }, [onReferenceImageChange]);

  // 드래그 앤 드롭으로 이미지 업로드
  useEffect(() => {
    let unlisten: (() => void | Promise<void>) | undefined;
    let isDisposed = false;
    let isUnlistenCalled = false;

    const safeUnlisten = (dispose?: () => void | Promise<void>) => {
      if (!dispose || isUnlistenCalled) return;
      isUnlistenCalled = true;
      try {
        Promise.resolve(dispose()).catch((error) => {
          console.warn('ConceptLeftPanel 드래그 리스너 비동기 해제 중 경고:', error);
        });
      } catch (error) {
        console.warn('ConceptLeftPanel 드래그 리스너 해제 중 경고:', error);
      }
    };

    const setup = async () => {
      const appWindow = getCurrentWindow();
      const dispose = await appWindow.onDragDropEvent(async (event) => {
        if (event.payload.type === 'drop') {
          const paths = event.payload.paths || [];
          if (paths.length > 0) {
            const filePath = paths[0];
            const ext = filePath.split('.').pop()?.toLowerCase();
            if (ext && ['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext)) {
              try {
                const fileData = await readFile(filePath);
                const base64 = btoa(
                  Array.from(new Uint8Array(fileData))
                    .map(b => String.fromCharCode(b))
                    .join('')
                );
                const mimeType = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
                const dataUrl = `data:${mimeType};base64,${base64}`;
                imageChangeRef.current(dataUrl);
              } catch (err) {
                console.error('파일 읽기 실패:', err);
              }
            }
          }
        }
      });

      if (isDisposed) {
        safeUnlisten(dispose);
        return;
      }
      unlisten = dispose;
    };

    setup();
    return () => {
      isDisposed = true;
      safeUnlisten(unlisten);
    };
  }, []);

  // 클립보드(Ctrl+V) 붙여넣기 지원 — 드래그 드롭과 동일 경로로 이미지 전달
  useImagePaste({
    onPaste: (dataUrl) => {
      imageChangeRef.current(dataUrl);
    },
  });

  // Tauri dialog를 사용한 파일 선택
  const handleFileSelect = useCallback(async () => {
    try {
      const selected = await open({
        multiple: false,
        filters: [
          {
            name: 'Image',
            extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'],
          },
        ],
      });

      if (selected && typeof selected === 'string') {
        const fileData = await readFile(selected);
        const base64 = btoa(
          Array.from(new Uint8Array(fileData))
            .map(b => String.fromCharCode(b))
            .join('')
        );
        const ext = selected.split('.').pop()?.toLowerCase();
        const mimeType = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
        const dataUrl = `data:${mimeType};base64,${base64}`;
        onReferenceImageChange(dataUrl);
      }
    } catch (err) {
      console.error('파일 선택 실패:', err);
    }
  }, [onReferenceImageChange]);

  // 장르 추가
  const handleAddGenre = useCallback((genre: string) => {
    if (genre && !gameGenres.includes(genre)) {
      onGameInfoChange({
        gameGenres: [...gameGenres, genre],
        gamePlayStyle: playStyleRef.current?.value || '',
        referenceGames: localReferenceGames,
        artStyles,
      });
    }
  }, [gameGenres, localReferenceGames, artStyles, onGameInfoChange]);

  // 장르 제거
  const handleRemoveGenre = useCallback((genre: string) => {
    onGameInfoChange({
      gameGenres: gameGenres.filter(g => g !== genre),
      gamePlayStyle: playStyleRef.current?.value || '',
      referenceGames: localReferenceGames,
      artStyles,
    });
  }, [gameGenres, localReferenceGames, artStyles, onGameInfoChange]);

  // 커스텀 장르 추가 (localStorage에 저장)
  const handleAddCustomGenre = useCallback((genre: string) => {
    if (!customGenres.includes(genre) && !GAME_GENRE_PRESETS.includes(genre as any)) {
      const updated = [...customGenres, genre];
      setCustomGenres(updated);
      saveCustomItems(CUSTOM_GENRES_KEY, updated);
    }
    handleAddGenre(genre);
  }, [customGenres, handleAddGenre]);

  // 커스텀 장르 삭제 (localStorage에서 제거)
  const handleRemoveCustomGenre = useCallback((genre: string) => {
    const updated = customGenres.filter(g => g !== genre);
    setCustomGenres(updated);
    saveCustomItems(CUSTOM_GENRES_KEY, updated);
    // 선택 목록에서도 제거
    handleRemoveGenre(genre);
  }, [customGenres, handleRemoveGenre]);

  // 스타일 추가
  const handleAddStyle = useCallback((style: string) => {
    if (style && !artStyles.includes(style)) {
      onGameInfoChange({
        gameGenres,
        gamePlayStyle: playStyleRef.current?.value || '',
        referenceGames: localReferenceGames,
        artStyles: [...artStyles, style],
      });
    }
  }, [gameGenres, localReferenceGames, artStyles, onGameInfoChange]);

  // 스타일 제거
  const handleRemoveStyle = useCallback((style: string) => {
    onGameInfoChange({
      gameGenres,
      gamePlayStyle: playStyleRef.current?.value || '',
      referenceGames: localReferenceGames,
      artStyles: artStyles.filter(s => s !== style),
    });
  }, [gameGenres, localReferenceGames, artStyles, onGameInfoChange]);

  // 커스텀 스타일 추가 (localStorage에 저장)
  const handleAddCustomStyle = useCallback((style: string) => {
    if (!customStyles.includes(style) && !ART_STYLE_PRESETS.includes(style as any)) {
      const updated = [...customStyles, style];
      setCustomStyles(updated);
      saveCustomItems(CUSTOM_STYLES_KEY, updated);
    }
    handleAddStyle(style);
  }, [customStyles, handleAddStyle]);

  // 커스텀 스타일 삭제 (localStorage에서 제거)
  const handleRemoveCustomStyle = useCallback((style: string) => {
    const updated = customStyles.filter(s => s !== style);
    setCustomStyles(updated);
    saveCustomItems(CUSTOM_STYLES_KEY, updated);
    handleRemoveStyle(style);
  }, [customStyles, handleRemoveStyle]);

  // 장르 드롭다운 변경 핸들러
  const handleGenreSelectChange = useCallback((value: string) => {
    if (value === '__custom__') {
      setShowGenrePopup(true);
    } else if (value) {
      handleAddGenre(value);
    }
  }, [handleAddGenre]);

  // 스타일 드롭다운 변경 핸들러
  const handleStyleSelectChange = useCallback((value: string) => {
    if (value === '__custom__') {
      setShowStylePopup(true);
    } else if (value) {
      handleAddStyle(value);
    }
  }, [handleAddStyle]);

  // 레퍼런스 게임 추가
  const handleAddReferenceGame = useCallback(() => {
    if (referenceGameInput.trim()) {
      const newGames = [...localReferenceGames, referenceGameInput.trim()];
      setLocalReferenceGames(newGames);
      setReferenceGameInput('');
      onGameInfoChange({
        gameGenres,
        gamePlayStyle: playStyleRef.current?.value || '',
        referenceGames: newGames,
        artStyles,
      });
    }
  }, [referenceGameInput, localReferenceGames, gameGenres, artStyles, onGameInfoChange]);

  return (
    <div className="flex-[7] bg-white border-r border-gray-200 flex flex-col">
      {/* 헤더 */}
      <div className="px-4 py-3 border-b border-gray-200">
        <h3 className="font-semibold text-gray-800">게임 컨셉 정보</h3>
      </div>

      {/* 스크롤 영역 */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-6">
        {/* 참조/생성 이미지 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            <div className="flex items-center gap-2">
              <Image className="w-4 h-4" />
              <span>참조/생성 이미지</span>
            </div>
          </label>

          {!referenceImage && !generatedImage ? (
            <div
              className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center hover:border-gray-400 transition-colors cursor-pointer"
              onClick={handleFileSelect}
            >
              <Upload className="w-8 h-8 mx-auto mb-2 text-gray-400" />
              <p className="text-sm text-gray-500">
                이미지를 드래그하거나 클릭하여 업로드
              </p>
            </div>
          ) : (
            <div className={`grid gap-3 ${generatedImage ? 'grid-cols-2' : 'grid-cols-1'}`}>
              {referenceImage && (
                <div className="rounded-lg border border-gray-200 bg-gray-50 p-2">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-xs font-semibold text-gray-600">참조 원본</span>
                    <button
                      onClick={() => onReferenceImageChange(undefined)}
                      className="p-1 rounded-full bg-red-500 text-white hover:bg-red-600 transition-colors"
                      title="참조 이미지 제거"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => setPreviewImage({ src: referenceImage, title: '참조 원본 이미지' })}
                    className="w-full rounded-md overflow-hidden bg-white"
                    title="클릭하여 크게 보기"
                  >
                    <LazyImage
                      src={referenceImage}
                      alt="참조 이미지"
                      className="w-full h-auto max-h-64 object-contain"
                    />
                  </button>
                </div>
              )}

              {generatedImage && (
                <div className="rounded-lg border border-gray-200 bg-gray-50 p-2">
                  <div className="mb-2">
                    <span className="text-xs font-semibold text-gray-600">생성 결과</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setPreviewImage({ src: generatedImage, title: '생성된 이미지' })}
                    className="w-full rounded-md overflow-hidden bg-white"
                    title="클릭하여 크게 보기"
                  >
                    <LazyImage
                      src={generatedImage}
                      alt="생성 이미지"
                      className="w-full h-auto max-h-64 object-contain"
                    />
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-6">
          {/* 게임 장르 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              <div className="flex items-center gap-2">
                <Gamepad2 className="w-4 h-4" />
                <span>게임 장르</span>
              </div>
            </label>

            {/* 선택된 장르 */}
            <div className="flex flex-wrap gap-2 mb-3">
              {gameGenres.map((genre) => (
                <span
                  key={genre}
                  className="inline-flex items-center gap-1 px-3 py-1 text-sm bg-purple-100 text-purple-700 rounded-full"
                >
                  {genre}
                  <button
                    onClick={() => handleRemoveGenre(genre)}
                    className="hover:text-purple-900"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
            </div>

            {/* 드롭다운: 프리셋 + 커스텀 + 직접 추가 */}
            <select
              onChange={(e) => {
                handleGenreSelectChange(e.target.value);
                e.target.value = '';
              }}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
            >
              <option value="">장르 선택...</option>
              {GAME_GENRE_PRESETS.map(genre => (
                <option key={genre} value={genre}>{genre}</option>
              ))}
              {customGenres.map(genre => (
                <option key={`custom-${genre}`} value={genre}>{genre}</option>
              ))}
              <option value="__custom__">+ 장르 직접 추가</option>
            </select>

            {/* 커스텀 장르 목록 (삭제 가능) */}
            {customGenres.length > 0 && (
              <div className="mt-2 space-y-1">
                {customGenres.map((genre) => (
                  <div key={genre} className="flex items-center justify-between px-2 py-1 bg-gray-50 rounded text-xs text-gray-600">
                    <span>{genre}</span>
                    <button
                      onClick={() => handleRemoveCustomGenre(genre)}
                      className="text-gray-400 hover:text-red-500 transition-colors"
                      title="커스텀 장르 삭제"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 원하는 스타일 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              <div className="flex items-center gap-2">
                <Palette className="w-4 h-4" />
                <span>원하는 스타일</span>
              </div>
            </label>

            {/* 선택된 스타일 */}
            <div className="flex flex-wrap gap-2 mb-3">
              {artStyles.map((style) => (
                <span
                  key={style}
                  className="inline-flex items-center gap-1 px-3 py-1 text-sm bg-blue-100 text-blue-700 rounded-full"
                >
                  {style}
                  <button
                    onClick={() => handleRemoveStyle(style)}
                    className="hover:text-blue-900"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
            </div>

            {/* 드롭다운: 프리셋 + 커스텀 + 직접 추가 */}
            <select
              onChange={(e) => {
                handleStyleSelectChange(e.target.value);
                e.target.value = '';
              }}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
            >
              <option value="">스타일 선택...</option>
              {ART_STYLE_PRESETS.map(style => (
                <option key={style} value={style}>{style}</option>
              ))}
              {customStyles.map(style => (
                <option key={`custom-${style}`} value={style}>{style}</option>
              ))}
              <option value="__custom__">+ 스타일 직접 추가</option>
            </select>

            {/* 커스텀 스타일 목록 (삭제 가능) */}
            {customStyles.length > 0 && (
              <div className="mt-2 space-y-1">
                {customStyles.map((style) => (
                  <div key={style} className="flex items-center justify-between px-2 py-1 bg-gray-50 rounded text-xs text-gray-600">
                    <span>{style}</span>
                    <button
                      onClick={() => handleRemoveCustomStyle(style)}
                      className="text-gray-400 hover:text-red-500 transition-colors"
                      title="커스텀 스타일 삭제"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 게임 플레이 방식 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              게임 플레이 방식
            </label>
            <textarea
              ref={playStyleRef}
              defaultValue={gamePlayStyle || ''}
              onInput={(e) => onGamePlayStyleDraftChange((e.target as HTMLTextAreaElement).value)}
              placeholder="예: 물리 시뮬레이션으로 공을 떨어뜨려 바구니에 넣는 게임"
              rows={3}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 resize-none"
            />
          </div>

          {/* 레퍼런스 게임 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              레퍼런스 게임
            </label>

            {/* 입력된 게임 목록 */}
            {localReferenceGames.length > 0 && (
              <div className="space-y-1 mb-2">
                {localReferenceGames.map((game, idx) => (
                  <div key={idx} className="flex items-center justify-between px-3 py-1.5 bg-gray-50 rounded">
                    <span className="text-sm">{game}</span>
                    <button
                      onClick={() => {
                        const newGames = localReferenceGames.filter((_, i) => i !== idx);
                        setLocalReferenceGames(newGames);
                        onGameInfoChange({
                          gameGenres,
                          gamePlayStyle: playStyleRef.current?.value || '',
                          referenceGames: newGames,
                          artStyles,
                        });
                      }}
                      className="text-gray-400 hover:text-red-500"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="flex gap-2">
              <input
                type="text"
                value={referenceGameInput}
                onChange={(e) => setReferenceGameInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleAddReferenceGame();
                  }
                }}
                placeholder="예: Happy Glass"
                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
              />
              <button
                onClick={handleAddReferenceGame}
                className="px-3 py-2 bg-purple-500 text-white rounded-lg hover:bg-purple-600 transition-colors"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* 이미지 미리보기 모달 */}
      {previewImage && (
        <div
          className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4"
          onClick={() => setPreviewImage(null)}
        >
          <div
            className="relative bg-white rounded-lg shadow-2xl max-w-[95vw] max-h-[95vh] p-3"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setPreviewImage(null)}
              className="absolute top-2 right-2 p-1.5 rounded-full bg-gray-800/80 text-white hover:bg-gray-900"
            >
              <X className="w-4 h-4" />
            </button>
            <div className="mb-2 text-sm font-semibold text-gray-700 pr-8">{previewImage.title}</div>
            <LazyImage
              src={previewImage.src}
              alt={previewImage.title}
              className="max-w-[90vw] max-h-[85vh] w-auto h-auto object-contain"
            />
          </div>
        </div>
      )}

      {/* 장르 직접 추가 팝업 */}
      {showGenrePopup && (
        <CustomInputPopup
          title="장르를 입력하세요"
          placeholder="새 장르명 입력..."
          onSave={handleAddCustomGenre}
          onClose={() => setShowGenrePopup(false)}
        />
      )}

      {/* 스타일 직접 추가 팝업 */}
      {showStylePopup && (
        <CustomInputPopup
          title="스타일을 입력하세요"
          placeholder="새 스타일명 입력..."
          onSave={handleAddCustomStyle}
          onClose={() => setShowStylePopup(false)}
        />
      )}
    </div>
  );
});

ConceptLeftPanel.displayName = 'ConceptLeftPanel';
