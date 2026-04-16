// 폴더 타입 정의

export interface Folder {
  id: string;                    // UUID
  name: string;                  // 폴더 이름
  parentId: string | null;       // 부모 폴더 ID (null이면 루트)
  createdAt: string;             // ISO 8601
  updatedAt: string;             // ISO 8601
  order: number;                 // 같은 레벨에서의 순서
}

// 폴더 경로 (네비게이션 브레드크럼용)
export interface FolderPath {
  id: string;
  name: string;
}

// 폴더 저장 데이터 구조
export interface FolderData {
  folders: Folder[];
  sessionFolderMap: Record<string, string | null>; // 세션ID -> 폴더ID 매핑 (null이면 루트)
}
