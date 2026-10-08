/**
 * StyleStudio 앱 데이터 접근 (헤드리스)
 *
 * - API 키: 앱이 `settings.json`(Tauri plugin-store)에 저장한 `openrouter_api_key` 를 읽는다.
 *   환경변수 `OPENROUTER_API_KEY` 가 있으면 그것을 우선한다. **키는 어떤 응답에도 싣지 않는다.**
 * - 세션: 기존 세션의 분석 결과·참조 이미지를 "스타일 소스"로 재사용하기 위해 읽기만 한다.
 *   앱 데이터에는 절대 쓰지 않는다. → wiki/infra/mcp.md
 */

import { existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import type { ImageAnalysisResult } from '../../src/types/analysis';

/** Tauri 번들 식별자 — 앱 데이터 디렉토리 이름 (`tauri.conf.json` 의 `identifier`) */
export const BUNDLE_IDENTIFIER = 'com.woody.stylestudio-tauri';
/** 앱이 등록 시 실제 데이터 디렉토리를 넘겨주는 환경변수 */
export const DATA_DIR_ENV = 'STYLESTUDIO_DATA_DIR';

/** OS 별 Tauri `app_data_dir` 후보 (앞이 우선) */
function candidateDataDirs(): string[] {
  const dirs: string[] = [];
  const fromEnv = process.env[DATA_DIR_ENV];
  if (fromEnv) dirs.push(fromEnv);
  const home = homedir();
  switch (platform()) {
    case 'win32':
      dirs.push(join(process.env.APPDATA ?? join(home, 'AppData', 'Roaming'), BUNDLE_IDENTIFIER));
      break;
    case 'darwin':
      dirs.push(join(home, 'Library', 'Application Support', BUNDLE_IDENTIFIER));
      break;
    default:
      dirs.push(join(process.env.XDG_DATA_HOME ?? join(home, '.local', 'share'), BUNDLE_IDENTIFIER));
      dirs.push(join(process.env.XDG_CONFIG_HOME ?? join(home, '.config'), BUNDLE_IDENTIFIER));
  }
  return dirs;
}

export function resolveDataDir(): string {
  const dirs = candidateDataDirs();
  return dirs.find((d) => existsSync(join(d, 'settings.json'))) ?? dirs[0];
}

/** MCP 서버 자체 상태(비용 기록 등)를 두는 폴더 — 앱 데이터와 분리한다 */
export function stateDir(): string {
  const home = homedir();
  switch (platform()) {
    case 'win32':
      return join(process.env.LOCALAPPDATA ?? join(home, 'AppData', 'Local'), BUNDLE_IDENTIFIER, 'mcp');
    case 'darwin':
      return join(home, 'Library', 'Caches', BUNDLE_IDENTIFIER, 'mcp');
    default:
      return join(process.env.XDG_CACHE_HOME ?? join(home, '.cache'), BUNDLE_IDENTIFIER, 'mcp');
  }
}

/** 기본 출력 루트: ~/Downloads/AI_Gen/MCP (앱의 생성물 루트와 같은 계열) */
export function defaultOutputRoot(): string {
  return join(homedir(), 'Downloads', 'AI_Gen', 'MCP');
}

// ───────────────────────── 출력 경로 보호 ─────────────────────────

/** 존재하는 가장 가까운 조상까지 실제 경로(심볼릭 링크·junction·8.3 이름 해소)로 바꾸고 나머지를 붙인다 */
function realish(path: string): string {
  let existing = resolve(path);
  const rest: string[] = [];
  while (!existsSync(existing)) {
    const parent = dirname(existing);
    if (parent === existing) break;
    rest.unshift(basename(existing));
    existing = parent;
  }
  let real = existing;
  try {
    real = realpathSync.native(existing);
  } catch {
    // 해소 실패 시 resolve 결과 그대로
  }
  return join(real, ...rest);
}

/** target 이 base 안(같은 경로 포함)인지 — 문자열 접두사가 아니라 경로 관계로 판정 (형제 폴더 오탐 방지) */
export function isInside(target: string, base: string): boolean {
  const norm = (p: string) => (platform() === 'win32' ? realish(p).toLowerCase() : realish(p));
  const rel = relative(norm(base), norm(target));
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

/** 보호 폴더: 앱 데이터(settings.json·images) 와 앱 로컬 데이터(웹뷰·MCP 사본) */
function protectedDirs(dataDir: string): string[] {
  return [dataDir, dirname(stateDir())];
}

/** 앱 데이터 폴더 파일을 문서로 읽지 못하게 한다 — settings.json 에는 API 키가 있다 */
export function assertReadableDocument(target: string, dataDir: string): void {
  for (const dir of protectedDirs(dataDir)) {
    if (isInside(target, dir)) {
      throw new Error(`StyleStudio 앱 데이터 폴더의 파일은 참조 문서로 쓸 수 없습니다: ${target}`);
    }
  }
}

/**
 * 모든 쓰기 경로가 지나야 하는 검사. 앱 데이터 폴더 안이면 거부한다 —
 * 서버는 앱 데이터를 절대 수정하지 않는다는 약속(wiki/infra/mcp.md)을 여기서 강제한다.
 */
export function assertWritable(target: string, dataDir: string): void {
  for (const dir of protectedDirs(dataDir)) {
    if (isInside(target, dir)) {
      throw new Error(`StyleStudio 앱 데이터 폴더 안에는 쓸 수 없습니다: ${target}. 다른 폴더를 지정하세요.`);
    }
  }
}

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/** 파일·폴더 이름으로 쓸 수 있게 정리 (금지문자·제어문자·Windows 예약 이름) */
export function sanitizeName(name: string, fallback: string): string {
  let cleaned = name
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\.+$/, '')
    .slice(0, 60)
    .trim();
  if (WINDOWS_RESERVED.test(cleaned)) cleaned = `${cleaned}_`;
  return cleaned || fallback;
}

/** 새 파일로만 쓴다. 같은 이름이 있으면 _2, _3 … (절대 덮어쓰지 않는다) */
export function writeUnique(dir: string, base: string, ext: string, bytes: Uint8Array | string): string {
  mkdirSync(dir, { recursive: true });
  for (let i = 1; i < 10_000; i++) {
    const path = join(dir, i === 1 ? `${base}.${ext}` : `${base}_${i}.${ext}`);
    try {
      writeFileSync(path, bytes, { flag: 'wx' });
      return path;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
  }
  throw new Error(`파일 이름을 정할 수 없습니다: ${base}`);
}

// ───────────────────────── settings.json ─────────────────────────

interface SettingsCache {
  mtimeMs: number;
  size: number;
  value: Record<string, unknown>;
}

let cache: SettingsCache | null = null;

/** settings.json 을 읽는다. 바뀌지 않았으면 이전 파싱 결과를 재사용한다. */
function readSettings(dataDir: string): Record<string, unknown> {
  const path = join(dataDir, 'settings.json');
  if (!existsSync(path)) {
    throw new Error(
      `StyleStudio 데이터를 찾을 수 없습니다 (${path}). StyleStudio 를 한 번 실행해 설정을 저장했는지 확인하세요.`
    );
  }
  const stat = statSync(path);
  if (cache && cache.mtimeMs === stat.mtimeMs && cache.size === stat.size) {
    return cache.value;
  }
  let value: Record<string, unknown>;
  try {
    value = JSON.parse(readFileSync(path, 'utf-8'));
  } catch (error) {
    // 앱이 저장하는 도중이면 잘린 JSON 일 수 있다 — 한 번만 다시 읽는다
    const retry = readFileSync(path, 'utf-8');
    try {
      value = JSON.parse(retry);
    } catch {
      throw new Error(`settings.json 파싱 실패: ${(error as Error).message}`);
    }
  }
  cache = { mtimeMs: stat.mtimeMs, size: stat.size, value };
  return value;
}

/** OpenRouter API 키. 없으면 사용자가 할 일을 담은 오류를 던진다. */
export function getApiKey(dataDir: string): string {
  const fromEnv = process.env.OPENROUTER_API_KEY?.trim();
  if (fromEnv) return fromEnv;
  let key: unknown;
  try {
    key = readSettings(dataDir).openrouter_api_key;
  } catch (error) {
    throw new Error(`OpenRouter API 키를 읽을 수 없습니다: ${(error as Error).message}`);
  }
  if (typeof key !== 'string' || !key.trim()) {
    throw new Error('StyleStudio 설정에 OpenRouter API 키가 없습니다. 앱 설정에서 키를 저장하세요.');
  }
  return key.trim();
}

/** 키 출처 — 환경변수가 앱 키를 덮어쓰면 다른 계정으로 과금되므로 ss_info 로 알린다 */
export function apiKeySource(): 'env' | 'settings' {
  return process.env.OPENROUTER_API_KEY?.trim() ? 'env' : 'settings';
}

export function hasApiKey(dataDir: string): boolean {
  try {
    return !!getApiKey(dataDir);
  } catch {
    return false;
  }
}

// ───────────────────────── 세션 (스타일 소스) ─────────────────────────

export interface SessionSummary {
  id: string;
  name: string;
  type: string;
  updatedAt?: string;
  folderPath: string;
  referenceCount: number;
  hasAnalysis: boolean;
}

export interface SessionStyle {
  id: string;
  name: string;
  type: string;
  analysis?: ImageAnalysisResult;
  /** 참조 이미지 data URL (읽지 못한 것은 빠진다) */
  referenceImages: string[];
  missingReferences: number;
}

type Json = Record<string, unknown>;

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

/** 분석 결과가 실제로 채워져 있는지 (새 세션은 빈 문자열로 채운 더미 분석을 가진다) */
function hasMeaningfulAnalysis(analysis: unknown): boolean {
  if (!analysis || typeof analysis !== 'object') return false;
  const style = (analysis as Json).style as Json | undefined;
  return !!style && Object.values(style).some((v) => typeof v === 'string' && v.trim().length > 0);
}

function folderPath(folders: Json[], folderId: string | undefined): string {
  const names: string[] = [];
  let current = folderId;
  // 손상 데이터의 순환 참조 방지
  for (let i = 0; i < 64 && current; i++) {
    const folder = folders.find((f) => f.id === current);
    if (!folder) break;
    names.unshift(String(folder.name ?? ''));
    current = str(folder.parentId);
  }
  return names.join(' / ');
}

/** 참조 이미지 원천: imageKeys 우선, 같은 인덱스의 referenceImages(인라인)를 폴백으로 (앱 loadSessions 와 같은 규칙) */
function referenceSources(session: Json): { key?: string; inline?: string }[] {
  const keys = asArray(session.imageKeys).map(str);
  const refs = asArray(session.referenceImages).map(str);
  const count = keys.length > 0 ? keys.length : refs.length;
  const sources: { key?: string; inline?: string }[] = [];
  for (let i = 0; i < count; i++) {
    const values = [keys[i], refs[i]].filter((v): v is string => !!v);
    sources.push({
      key: values.find((v) => !v.startsWith('data:')),
      inline: values.find((v) => v.startsWith('data:')),
    });
  }
  return sources;
}

/** 저장소 키 → data URL. 경로 탈출 문자가 있으면 거부한다. */
function loadImageKey(dataDir: string, rawKey: string): string | undefined {
  let key = rawKey.trim();
  if (key.startsWith('images/')) key = key.slice('images/'.length);
  if (key.endsWith('.txt')) key = key.slice(0, -'.txt'.length);
  if (!key || /[\\/:]|\.\./.test(key)) return undefined;
  const path = join(dataDir, 'images', `${key}.txt`);
  return existsSync(path) ? readFileSync(path, 'utf-8').trim() : undefined;
}

export function listSessions(dataDir: string): SessionSummary[] {
  const settings = readSettings(dataDir);
  const folders = asArray(settings.folders) as Json[];
  const folderMap = (settings.session_folder_map ?? {}) as Record<string, string | null>;
  return (asArray(settings.sessions) as Json[])
    .filter((s) => str(s.id))
    .map((s) => {
      const id = String(s.id);
      // 세션 소속의 권위는 session_folder_map (wiki 알려진 함정)
      const folderId = id in folderMap ? folderMap[id] ?? undefined : str(s.folderId);
      return {
        id,
        name: str(s.name) ?? 'untitled',
        type: str(s.type) ?? '',
        updatedAt: str(s.updatedAt),
        folderPath: folderPath(folders, folderId),
        referenceCount: referenceSources(s).length,
        hasAnalysis: hasMeaningfulAnalysis(s.analysis),
      };
    })
    .sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));
}

export function getSessionStyle(dataDir: string, sessionId: string): SessionStyle {
  const settings = readSettings(dataDir);
  const session = (asArray(settings.sessions) as Json[]).find((s) => s.id === sessionId);
  if (!session) {
    throw new Error(`세션을 찾을 수 없습니다: ${sessionId}. ss_list_sessions 로 id 를 확인하세요.`);
  }
  const images: string[] = [];
  let missing = 0;
  for (const source of referenceSources(session)) {
    const loaded = (source.key && loadImageKey(dataDir, source.key)) || source.inline;
    if (loaded && loaded.startsWith('data:')) images.push(loaded);
    else missing++;
  }
  return {
    id: String(session.id),
    name: str(session.name) ?? 'untitled',
    type: str(session.type) ?? '',
    analysis: hasMeaningfulAnalysis(session.analysis)
      ? (session.analysis as unknown as ImageAnalysisResult)
      : undefined,
    referenceImages: images,
    missingReferences: missing,
  };
}
