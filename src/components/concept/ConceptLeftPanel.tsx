import { useState, useCallback, useEffect, useRef, memo } from 'react';
import { Upload, X, Plus, Trash2, Image, Gamepad2, Palette } from 'lucide-react';
import { GAME_GENRE_PRESETS, ART_STYLE_PRESETS } from '../../types/concept';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { readFile } from '@tauri-apps/plugin-fs';
import { open } from '@tauri-apps/plugin-dialog';

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
  const [customGenre, setCustomGenre] = useState('');
  const [customStyle, setCustomStyle] = useState('');
  const [referenceGameInput, setReferenceGameInput] = useState('');
  const [localReferenceGames, setLocalReferenceGames] = useState<string[]>(referenceGames || []);
  const [previewImage, setPreviewImage] = useState<{ src: string; title: string } | null>(null);
  const playStyleRef = useRef<HTMLTextAreaElement>(null);

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
    let unlisten: (() => void) | undefined;

    const setup = async () => {
      const appWindow = getCurrentWindow();
      unlisten = await appWindow.onDragDropEvent(async (event) => {
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
    };

    setup();
    return () => { if (unlisten) unlisten(); };
  }, []); // 의존성 배열을 비워서 한 번만 실행되도록 수정

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
                    <img
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
                    <img
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

            {/* 프리셋 선택 */}
            <select
              onChange={(e) => {
                if (e.target.value) {
                  handleAddGenre(e.target.value);
                  e.target.value = '';
                }
              }}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 mb-2"
            >
              <option value="">장르 선택...</option>
              {GAME_GENRE_PRESETS.map(genre => (
                <option key={genre} value={genre}>{genre}</option>
              ))}
            </select>

            {/* 커스텀 입력 */}
            <div className="flex gap-2">
              <input
                type="text"
                value={customGenre}
                onChange={(e) => setCustomGenre(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleAddGenre(customGenre);
                    setCustomGenre('');
                  }
                }}
                placeholder="직접 입력..."
                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
              />
              <button
                onClick={() => {
                  handleAddGenre(customGenre);
                  setCustomGenre('');
                }}
                className="px-3 py-2 bg-purple-500 text-white rounded-lg hover:bg-purple-600 transition-colors"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>
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

            {/* 프리셋 선택 */}
            <select
              onChange={(e) => {
                if (e.target.value) {
                  handleAddStyle(e.target.value);
                  e.target.value = '';
                }
              }}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 mb-2"
            >
              <option value="">스타일 선택...</option>
              {ART_STYLE_PRESETS.map(style => (
                <option key={style} value={style}>{style}</option>
              ))}
            </select>

            {/* 커스텀 입력 */}
            <div className="flex gap-2">
              <input
                type="text"
                value={customStyle}
                onChange={(e) => setCustomStyle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleAddStyle(customStyle);
                    setCustomStyle('');
                  }
                }}
                placeholder="직접 입력..."
                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
              />
              <button
                onClick={() => {
                  handleAddStyle(customStyle);
                  setCustomStyle('');
                }}
                className="px-3 py-2 bg-purple-500 text-white rounded-lg hover:bg-purple-600 transition-colors"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>
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
            <img
              src={previewImage.src}
              alt={previewImage.title}
              className="max-w-[90vw] max-h-[85vh] w-auto h-auto object-contain"
            />
          </div>
        </div>
      )}
    </div>
  );
});

ConceptLeftPanel.displayName = 'ConceptLeftPanel';