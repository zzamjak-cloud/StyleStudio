import { useState, useEffect, useRef } from 'react';
import { FileText, Plus, FileSearch, Trash2, X, Link, HelpCircle } from 'lucide-react';
import { open } from '@tauri-apps/plugin-dialog';
import { ReferenceDocument } from '../../types/referenceDocument';
import { parseFile, SUPPORTED_FILE_TYPES } from '../../lib/utils/fileParser';
import { generateFileSummary, validateFileSize } from '../../lib/utils/fileOptimization';
import { subscribeWindowDragDrop } from '../../lib/windowDragDropBus';

interface DocumentManagerProps {
  documents: ReferenceDocument[];
  apiKey: string;
  onAdd: (document: ReferenceDocument) => void;
  onDelete: (documentId: string) => void;
  showPersistentBadge?: boolean;
  persistentBadgeText?: string;
}

export function DocumentManager({
  documents,
  apiKey,
  onAdd,
  onDelete,
  showPersistentBadge = false,
  persistentBadgeText = '대화 참조중',
}: DocumentManagerProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [viewingDocument, setViewingDocument] = useState<ReferenceDocument | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [showUrlInput, setShowUrlInput] = useState(false);
  const [urlInput, setUrlInput] = useState('');
  const documentsRef = useRef(documents);
  const processingPathsRef = useRef(new Set<string>());
  const lastDropAtRef = useRef(0);

  documentsRef.current = documents;

  // 드래그 앤 드롭 설정
  useEffect(() => {
    const unsubscribe = subscribeWindowDragDrop(async (event) => {
      if (event.payload.type === 'enter' || event.payload.type === 'over') {
        setIsDragging(true);
      } else if (event.payload.type === 'leave') {
        setIsDragging(false);
      } else if (event.payload.type === 'drop') {
        const now = Date.now();
        // 동일 drop 이벤트가 중복 전달되는 경우 방지
        if (now - lastDropAtRef.current < 500) {
          return;
        }
        lastDropAtRef.current = now;
        setIsDragging(false);

        const paths = event.payload.paths || [];

        // 이미지 파일 확장자 목록
        const imageExtensions = ['png', 'jpg', 'jpeg', 'gif', 'webp'];

        // 확장자 검증 (지원하는 모든 형식 허용)
        const validFiles: string[] = [];
        const invalidFiles: string[] = [];

        for (const path of paths) {
          const ext = path.split('.').pop()?.toLowerCase();

          // 이미지 파일은 무시 (useImageHandling에서 처리)
          if (ext && imageExtensions.includes(ext)) {
            continue;
          }

          if (ext && SUPPORTED_FILE_TYPES.includes(ext as any)) {
            validFiles.push(path);
          } else {
            invalidFiles.push(path);
          }
        }

        if (invalidFiles.length > 0) {
          alert(
            `지원하지 않는 파일 형식입니다:\n${invalidFiles.join('\n')}\n\nPDF, Excel, CSV, Markdown, Text 파일만 첨부 가능합니다.`
          );
        }

        if (validFiles.length > 0) {
          await processFiles(validFiles);
        }
      }
    });

    return () => {
      unsubscribe();
    };
  }, []);

  // 파일 처리 함수
  const processFiles = async (filePaths: string[]) => {
    setIsProcessing(true);

    const uniquePaths = [...new Set(filePaths)];

    for (const filePath of uniquePaths) {
      if (
        documentsRef.current.some((doc) => doc.filePath === filePath) ||
        processingPathsRef.current.has(filePath)
      ) {
        continue;
      }

      try {
        processingPathsRef.current.add(filePath);
        const fileName = filePath.split('/').pop() || 'unknown';

        // 파일 파싱
        const parsed = await parseFile(filePath, fileName);

        // 파일 크기 검증
        const validation = validateFileSize(parsed.text);
        const finalContent = validation.valid ? parsed.text : validation.truncated || parsed.text;

        // 요약 생성 (AI 사용, 실패 시 간단 요약)
        let summary = '';
        try {
          summary = await generateFileSummary(finalContent, fileName, apiKey);
        } catch (error) {
          console.error('요약 생성 실패:', error);
          summary = finalContent.substring(0, 500) + (finalContent.length > 500 ? '...' : '');
        }

        // ReferenceDocument 생성
        const now = Date.now();
        const randomId = Math.random().toString(36).substring(2, 9);
        const document: ReferenceDocument = {
          id: `ref-${now}-${randomId}`,
          fileName,
          filePath,
          fileType: parsed.metadata?.fileType || 'unknown',
          content: finalContent,
          summary,
          metadata: {
            pageCount: parsed.metadata?.pageCount,
            sheetCount: parsed.metadata?.sheetCount,
            lineCount: finalContent.split('\n').length,
            characterCount: finalContent.length,
            extractedImageCount: parsed.metadata?.extractedImageCount,
          },
          extractedImages: parsed.extractedImages,
          createdAt: now,
          updatedAt: now,
        };

        onAdd(document);
      } catch (error) {
        console.error(`파일 처리 실패 (${filePath}):`, error);
        alert(`파일 처리 실패: ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        processingPathsRef.current.delete(filePath);
      }
    }

    setIsProcessing(false);
  };

  // URL 처리 함수
  const processUrl = async (url: string) => {
    if (!url.trim()) {
      alert('URL을 입력해주세요.');
      return;
    }

    // URL 형식 검증
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      alert('올바른 URL 형식이 아닙니다. http:// 또는 https://로 시작해야 합니다.');
      return;
    }

    if (documentsRef.current.some((doc) => doc.filePath === url)) {
      alert('이미 추가된 URL입니다.');
      return;
    }

    setIsProcessing(true);
    setShowUrlInput(false);
    setUrlInput('');

    try {
      // URL에서 제목 추출
      let fileName = url;
      try {
        const urlObj = new URL(url);
        fileName = urlObj.hostname + urlObj.pathname;
      } catch {
        fileName = url;
      }

      // URL 파싱
      const parsed = await parseFile(url, fileName);

      // 파일 크기 검증
      const validation = validateFileSize(parsed.text);
      const finalContent = validation.valid ? parsed.text : validation.truncated || parsed.text;

      // 요약 생성 (AI 사용, 실패 시 간단 요약)
      let summary = '';
      try {
        summary = await generateFileSummary(finalContent, fileName, apiKey);
      } catch (error) {
        console.error('요약 생성 실패:', error);
        summary = finalContent.substring(0, 500) + (finalContent.length > 500 ? '...' : '');
      }

      // ReferenceDocument 생성
      const now = Date.now();
      const randomId = Math.random().toString(36).substring(2, 9);
      const document: ReferenceDocument = {
        id: `ref-${now}-${randomId}`,
        fileName,
        filePath: url,
        fileType: parsed.metadata?.fileType || 'webpage',
        content: finalContent,
        summary,
        metadata: {
          lineCount: finalContent.split('\n').length,
          characterCount: finalContent.length,
          extractedImageCount: parsed.metadata?.extractedImageCount,
        },
        extractedImages: parsed.extractedImages,
        createdAt: now,
        updatedAt: now,
      };

      onAdd(document);
    } catch (error) {
      console.error(`URL 처리 실패 (${url}):`, error);
      alert(`URL 처리 실패: ${error instanceof Error ? error.message : String(error)}`);
    }

    setIsProcessing(false);
  };

  // 파일 추가 버튼 클릭
  const handleAddFile = async () => {
    try {
      const selected = await open({
        multiple: true,
        filters: [
          {
            name: '지원 파일',
            extensions: SUPPORTED_FILE_TYPES.slice() as string[],
          },
        ],
      });

      if (selected && Array.isArray(selected)) {
        await processFiles(selected);
      } else if (selected && typeof selected === 'string') {
        await processFiles([selected]);
      }
    } catch (error) {
      console.error('파일 선택 실패:', error);
    }
  };

  // 삭제 확인 함수
  const confirmDelete = () => {
    if (deleteConfirm) {
      onDelete(deleteConfirm);
      setDeleteConfirm(null);
    }
  };

  return (
    <div className="relative">
      <div
        className={`flex min-h-[38px] items-center gap-2 rounded-lg border border-dashed px-2.5 py-1.5 transition-colors ${
          isDragging
            ? 'border-purple-500 bg-purple-50'
            : 'border-gray-300 bg-white hover:border-purple-300'
        }`}
      >
        <FileText size={15} className="shrink-0 text-gray-500" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-xs font-semibold text-gray-800">기획 문서</span>
            <div className="group relative flex">
              <button
                type="button"
                className="rounded-full p-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                aria-label="기획 문서 도움말"
              >
                <HelpCircle size={13} />
              </button>
              <div className="pointer-events-none absolute left-0 top-full z-30 mt-2 hidden w-64 rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-xs leading-relaxed text-white shadow-xl group-hover:block">
                PDF, Excel, CSV, Markdown, Text 파일과 Google Sheets 또는 웹 페이지 URL을 참조 문서로 추가합니다. 요약 내용은 이미지 생성 프롬프트에 반영됩니다.
              </div>
            </div>
          </div>
          <p className="truncate text-[11px] text-gray-500">
            {documents.length === 0
              ? '파일을 이 줄에 드롭하거나 오른쪽 버튼으로 추가'
              : `${documents.length}개 문서가 프롬프트에 반영됨`}
          </p>
        </div>
        <button
          onClick={() => setShowUrlInput(true)}
          disabled={isProcessing}
          className="shrink-0 rounded-md p-1.5 hover:bg-gray-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          title="URL 추가"
        >
          <Link size={14} className="text-gray-700" />
        </button>
        <button
          onClick={handleAddFile}
          disabled={isProcessing}
          className="shrink-0 rounded-md p-1.5 hover:bg-gray-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          title="파일 추가"
        >
          <Plus size={14} className="text-gray-700" />
        </button>
      </div>

      {documents.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {documents.map((doc) => (
            <div
              key={doc.id}
              className="flex max-w-full items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2 py-1 shadow-sm"
            >
              <FileText size={13} className="shrink-0 text-gray-500" />
              <span className="max-w-[160px] truncate text-[11px] font-medium text-gray-800">
                {doc.fileName}
              </span>
              {showPersistentBadge && (
                <span className="shrink-0 rounded border border-blue-200 bg-blue-50 px-1 py-0.5 text-[9px] font-medium text-blue-700">
                  {persistentBadgeText}
                </span>
              )}
              <button
                onClick={() => setViewingDocument(doc)}
                className="shrink-0 rounded p-0.5 hover:bg-gray-100 transition-colors"
                title="요약 보기"
              >
                <FileSearch size={12} className="text-gray-600" />
              </button>
              <button
                onClick={() => setDeleteConfirm(doc.id)}
                className="shrink-0 rounded p-0.5 hover:bg-red-100 transition-colors"
                title="삭제"
              >
                <Trash2 size={12} className="text-red-600" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* 드래그 오버레이 */}
      {isDragging && (
        <div className="absolute inset-0 z-10 pointer-events-none rounded-lg border-2 border-dashed border-purple-500 bg-purple-500/10" />
      )}

      {/* 처리 중 오버레이 */}
      {isProcessing && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/20 rounded-lg z-10">
          <div className="bg-white rounded-lg shadow-xl px-6 py-4">
            <p className="text-sm font-semibold text-gray-900">파일 처리 중...</p>
          </div>
        </div>
      )}

      {/* 삭제 확인 다이얼로그 */}
      {deleteConfirm && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setDeleteConfirm(null);
            }
          }}
        >
          <div className="bg-white rounded-lg shadow-xl max-w-sm w-full p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold mb-2 text-gray-900">문서 삭제 확인</h3>
            <p className="text-gray-600 mb-6">
              이 문서를 삭제하시겠습니까?
              <br />
              이 작업은 되돌릴 수 없습니다.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setDeleteConfirm(null)}
                className="px-4 py-2 rounded-lg bg-gray-200 hover:bg-gray-300 transition-colors font-medium text-gray-700"
              >
                취소
              </button>
              <button
                onClick={confirmDelete}
                className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 transition-colors font-medium text-white"
              >
                삭제
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 요약 보기 모달 */}
      {viewingDocument && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setViewingDocument(null);
            }
          }}
        >
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            {/* 모달 헤더 */}
            <div className="flex items-center justify-between p-6 border-b border-gray-200">
              <h3 className="text-lg font-semibold text-gray-900">{viewingDocument.fileName}</h3>
              <button onClick={() => setViewingDocument(null)} className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
                <X size={20} className="text-gray-500" />
              </button>
            </div>

            {/* 모달 본문 */}
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              {/* 요약 */}
              {viewingDocument.summary && (
                <div>
                  <h4 className="text-sm font-semibold text-gray-700 mb-2">요약</h4>
                  <p className="text-sm text-gray-600 whitespace-pre-wrap">{viewingDocument.summary}</p>
                </div>
              )}

              {/* 메타데이터 */}
              {viewingDocument.metadata && (
                <div>
                  <h4 className="text-sm font-semibold text-gray-700 mb-2">정보</h4>
                  <dl className="grid grid-cols-2 gap-2 text-sm">
                    {viewingDocument.metadata.pageCount && (
                      <>
                        <dt className="text-gray-500">페이지 수:</dt>
                        <dd className="text-gray-900">{viewingDocument.metadata.pageCount}쪽</dd>
                      </>
                    )}
                    {viewingDocument.metadata.sheetCount && (
                      <>
                        <dt className="text-gray-500">시트 수:</dt>
                        <dd className="text-gray-900">{viewingDocument.metadata.sheetCount}개</dd>
                      </>
                    )}
                    {viewingDocument.metadata.lineCount && (
                      <>
                        <dt className="text-gray-500">줄 수:</dt>
                        <dd className="text-gray-900">{viewingDocument.metadata.lineCount}줄</dd>
                      </>
                    )}
                    {viewingDocument.metadata.characterCount && (
                      <>
                        <dt className="text-gray-500">문자 수:</dt>
                        <dd className="text-gray-900">{viewingDocument.metadata.characterCount.toLocaleString()}자</dd>
                      </>
                    )}
                  </dl>
                </div>
              )}

              {/* 전체 내용 (스크롤 가능) */}
              <details>
                <summary className="text-sm font-semibold text-gray-700 cursor-pointer hover:text-gray-900 transition-colors">
                  전체 내용 보기
                </summary>
                <div className="mt-2 p-4 bg-gray-50 rounded-lg max-h-96 overflow-y-auto">
                  <pre className="text-xs text-gray-600 whitespace-pre-wrap font-mono">{viewingDocument.content}</pre>
                </div>
              </details>
            </div>
          </div>
        </div>
      )}

      {/* URL 입력 모달 */}
      {showUrlInput && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setShowUrlInput(false);
              setUrlInput('');
            }
          }}
        >
          <div className="bg-white rounded-lg shadow-xl max-w-lg w-full p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900">URL 추가</h3>
              <button
                onClick={() => {
                  setShowUrlInput(false);
                  setUrlInput('');
                }}
                className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <X size={20} className="text-gray-500" />
              </button>
            </div>

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                URL 입력
              </label>
              <input
                type="text"
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    processUrl(urlInput);
                  }
                }}
                placeholder="https://docs.google.com/spreadsheets/..."
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                autoFocus
              />
              <p className="text-xs text-gray-500 mt-2">
                Google Spreadsheet, 웹 페이지 등 다양한 URL을 지원합니다.
              </p>
            </div>

            <div className="flex gap-3 justify-end">
              <button
                onClick={() => {
                  setShowUrlInput(false);
                  setUrlInput('');
                }}
                className="px-4 py-2 rounded-lg bg-gray-200 hover:bg-gray-300 transition-colors font-medium text-gray-700"
              >
                취소
              </button>
              <button
                onClick={() => processUrl(urlInput)}
                className="px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-700 transition-colors font-medium text-white"
              >
                추가
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
