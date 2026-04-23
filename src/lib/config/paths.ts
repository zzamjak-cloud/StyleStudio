import { downloadDir, join } from '@tauri-apps/api/path';
import { exists, mkdir } from '@tauri-apps/plugin-fs';

// v0.4.4: 모든 생성 결과물의 루트 폴더 (~/Downloads/AI_Gen/)
export const AI_GEN_ROOT_SEGMENT = 'AI_Gen';
// 세션 메타데이터 저장 폴더
export const SESSIONS_SEGMENT = 'Sessions';

/** ~/Downloads/AI_Gen/ 절대 경로를 돌려준다. 없으면 생성한다. */
export async function getAiGenRoot(): Promise<string> {
  const downloads = await downloadDir();
  const root = await join(downloads, AI_GEN_ROOT_SEGMENT);
  if (!(await exists(root))) {
    await mkdir(root, { recursive: true });
  }
  return root;
}

/** ~/Downloads/AI_Gen/Sessions/ 절대 경로를 돌려준다. 없으면 생성한다. */
export async function getSessionsRoot(): Promise<string> {
  const root = await getAiGenRoot();
  const sessions = await join(root, SESSIONS_SEGMENT);
  if (!(await exists(sessions))) {
    await mkdir(sessions, { recursive: true });
  }
  return sessions;
}

/**
 * 특정 세션 이름에 대한 생성 이미지 저장 폴더 경로를 돌려준다.
 * (~/Downloads/AI_Gen/{sanitized session name}/)
 */
export async function getSessionImageFolder(sessionName: string): Promise<string> {
  const root = await getAiGenRoot();
  const safe = sanitizeFolderName(sessionName);
  const folder = await join(root, safe);
  if (!(await exists(folder))) {
    await mkdir(folder, { recursive: true });
  }
  return folder;
}

/** Windows/macOS 공통 금지 문자 치환 */
export function sanitizeFolderName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '_').trim() || 'untitled';
}
