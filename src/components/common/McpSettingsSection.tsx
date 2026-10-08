import { memo, useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Bot, Check, ChevronDown, ChevronRight, Copy, Download, RefreshCw, Trash2 } from 'lucide-react';
import {
  downloadMcpServer,
  getMcpConfigSnippet,
  getMcpSetupStatus,
  registerMcpClient,
  unregisterMcpClient,
  type McpClientStatus,
  type McpSetupStatus,
} from '../../lib/services/mcpService';

type Notice = { kind: 'ok' | 'error'; text: string } | null;

/**
 * 설정 모달의 "AI 에이전트 연동 (MCP)" 섹션.
 * Claude Code·Codex 등 로컬 에이전트가 StyleStudio 생성 기능을 대량 배치로 쓰도록
 * ss-mcp 서버를 각 클라이언트 설정 파일에 등록/해제한다.
 * 서버는 사용자 PC 의 Node 20.16+ 로 실행하고, Node 가 없으면 실행 파일을 한 번 내려받는다
 * (앱에 JS 런타임을 번들하지 않아 설치 크기를 지킨다 — wiki/infra/mcp.md "배포 방식").
 */
export const McpSettingsSection = memo(function McpSettingsSection() {
  const [expanded, setExpanded] = useState(false);
  const [status, setStatus] = useState<McpSetupStatus | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);

  const refresh = useCallback(async () => {
    try {
      setStatus(await getMcpSetupStatus());
    } catch (e) {
      setNotice({ kind: 'error', text: String(e) });
    }
  }, []);

  // 펼칠 때만 조회한다 — 설정 파일 읽기를 모달 열 때마다 하지 않도록
  useEffect(() => {
    if (expanded) {
      setNotice(null);
      void refresh();
    }
  }, [expanded, refresh]);

  const copySnippet = useCallback(async (client: McpClientStatus) => {
    const snippet = await getMcpConfigSnippet(client.id);
    await navigator.clipboard.writeText(snippet);
  }, []);

  const handleRegister = useCallback(
    async (client: McpClientStatus) => {
      setBusy(client.id);
      setNotice(null);
      try {
        const outcome = await registerMcpClient(client.id);
        await refresh();
        setNotice({
          kind: 'ok',
          text: `${client.label} 등록 완료 — ${outcome.configPath}${
            outcome.backupPath ? ' (기존 설정 백업됨)' : ''
          }. ${client.label}을(를) 재시작하면 적용됩니다.`,
        });
      } catch (e) {
        // 파일 쓰기가 막힌 환경을 위해 수동 등록용 조각을 클립보드로 넘긴다
        try {
          await copySnippet(client);
          setNotice({ kind: 'error', text: `${String(e)} — 수동 등록용 설정을 클립보드에 복사했습니다.` });
        } catch {
          setNotice({ kind: 'error', text: String(e) });
        }
      } finally {
        setBusy(null);
      }
    },
    [refresh, copySnippet]
  );

  const handleUnregister = useCallback(
    async (client: McpClientStatus) => {
      setBusy(client.id);
      setNotice(null);
      try {
        await unregisterMcpClient(client.id);
        await refresh();
        setNotice({ kind: 'ok', text: `${client.label} 등록을 해제했습니다.` });
      } catch (e) {
        setNotice({ kind: 'error', text: String(e) });
      } finally {
        setBusy(null);
      }
    },
    [refresh]
  );

  const handleCopy = useCallback(
    async (client: McpClientStatus) => {
      setBusy(client.id);
      try {
        await copySnippet(client);
        setNotice({ kind: 'ok', text: `${client.label} 수동 등록용 설정을 클립보드에 복사했습니다.` });
      } catch (e) {
        setNotice({ kind: 'error', text: String(e) });
      } finally {
        setBusy(null);
      }
    },
    [copySnippet]
  );

  const handleDownload = useCallback(async () => {
    setBusy('download');
    setNotice(null);
    try {
      await downloadMcpServer();
      await refresh();
      setNotice({ kind: 'ok', text: '실행 파일을 설치했습니다. 이제 아래에서 에이전트를 등록하세요.' });
    } catch (e) {
      setNotice({ kind: 'error', text: String(e) });
    } finally {
      setBusy(null);
    }
  }, [refresh]);

  const runtime = status?.runtime;
  const serverMissing = status !== null && status.runtime.mode === 'none';
  // 실행 파일 모드인데 앱이 업데이트돼 버전이 다르면 다시 받아야 한다
  const standaloneOutdated =
    !!runtime && runtime.mode !== 'node' && runtime.standaloneInstalled && runtime.standaloneVersion !== status?.appVersion;
  // 작업은 한 번에 하나만 — 동시에 누르면 서버 사본 설치가 겹치고 busy 표시가 서로 풀린다
  const anyBusy = busy !== null;

  return (
    <div>
      <button
        onClick={() => setExpanded((prev) => !prev)}
        className="flex items-center gap-2 text-sm font-semibold text-gray-700 hover:text-purple-600 transition-colors"
      >
        <Bot size={16} />
        AI 에이전트 연동 (MCP)
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
      </button>

      {expanded && (
        <div className="mt-2 p-3 bg-gray-50 border border-gray-200 rounded-lg space-y-3">
          <p className="text-xs text-gray-600 leading-relaxed">
            로컬에 설치된 Claude Code·Codex 가 StyleStudio 의 세션별 생성 기능(세션 템플릿·그리드·투명 배경·픽셀
            정규화·참조 분석)으로 이미지를 <strong>대량 배치 생성</strong>해 파일로 받을 수 있게 합니다. 앱이 꺼져
            있어도 동작하며, 여기 저장된 OpenRouter 키로 과금됩니다(키 자체는 에이전트에게 노출되지 않습니다).
          </p>

          {/* 실행 런타임 — Node 가 있으면 그대로, 없으면 실행 파일 다운로드 */}
          {runtime && (
            <div
              className={`flex items-start gap-2 p-2 rounded-md text-xs ${
                serverMissing || standaloneOutdated ? 'bg-amber-50 text-amber-800' : 'bg-white border border-gray-200 text-gray-600'
              }`}
            >
              {serverMissing || standaloneOutdated ? (
                <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              ) : (
                <Check size={14} className="mt-0.5 shrink-0 text-emerald-500" />
              )}
              <div className="flex-1 space-y-1">
                {runtime.mode === 'node' && (
                  <span>
                    Node {runtime.nodeVersion} 로 실행합니다 <span className="text-gray-400 break-all">({runtime.nodePath})</span>
                  </span>
                )}
                {runtime.mode === 'standalone' && <span>내려받은 실행 파일로 실행합니다 (v{runtime.standaloneVersion})</span>}
                {serverMissing && !standaloneOutdated && (
                  <span>
                    Node {runtime.minNodeVersion} 이상이 없습니다. Node 를 설치하거나(권장, nodejs.org) 실행 파일을 한 번 내려받으세요.
                  </span>
                )}
                {standaloneOutdated && (
                  <span>
                    내려받은 실행 파일(v{runtime.standaloneVersion ?? '?'})이 앱 버전(v{status?.appVersion})과 다릅니다. 다시 내려받으세요.
                  </span>
                )}
                {!runtime.scriptBundled && runtime.mode !== 'standalone' && (
                  <span className="block">MCP 서버 스크립트가 앱에 포함돼 있지 않습니다. 앱을 다시 설치해 주세요.</span>
                )}
                {(serverMissing || standaloneOutdated) && runtime.downloadAvailable && (
                  <button
                    onClick={handleDownload}
                    disabled={anyBusy}
                    className="mt-1 inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-40"
                  >
                    <Download size={12} />
                    {busy === 'download' ? '내려받는 중… (약 40MB)' : '실행 파일 다운로드 (약 40MB)'}
                  </button>
                )}
              </div>
            </div>
          )}

          <ul className="space-y-1.5">
            {(status?.clients ?? []).map((client) => {
              const registered = client.state !== 'not_registered';
              const outdated = client.state === 'outdated';
              return (
                <li
                  key={client.id}
                  className="flex items-center gap-2 px-3 py-2 rounded-md bg-white border border-gray-200"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm text-gray-800">{client.label}</span>
                      <span className="text-[11px] text-gray-400">{client.covers}</span>
                      {client.state === 'registered' && <Check size={13} className="text-emerald-500" />}
                      {outdated && <RefreshCw size={12} className="text-amber-500" />}
                    </div>
                    <div className="text-[11px] truncate text-gray-500" title={client.configPath}>
                      {outdated ? '갱신 필요 — 경로나 서버 버전이 현재 앱과 다릅니다' : client.configPath}
                    </div>
                  </div>
                  <button
                    onClick={() => handleCopy(client)}
                    disabled={serverMissing || anyBusy}
                    title="수동 등록용 설정 복사"
                    className="p-1.5 rounded text-gray-500 hover:bg-gray-100 disabled:opacity-40"
                  >
                    <Copy size={13} />
                  </button>
                  {registered && (
                    <button
                      onClick={() => handleUnregister(client)}
                      disabled={anyBusy}
                      title="등록 해제"
                      className="p-1.5 rounded text-red-500 hover:bg-red-50 disabled:opacity-40"
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                  <button
                    onClick={() => handleRegister(client)}
                    disabled={serverMissing || anyBusy}
                    className="px-2.5 py-1 text-xs rounded-md bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-40"
                  >
                    {outdated ? '갱신' : registered ? '재등록' : '등록'}
                  </button>
                </li>
              );
            })}
          </ul>

          {notice && (
            <div
              className={`px-3 py-2 rounded-md text-xs break-all ${
                notice.kind === 'ok' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'
              }`}
            >
              {notice.text}
            </div>
          )}

          <p className="text-[11px] text-gray-500 leading-relaxed">
            등록 후 해당 에이전트를 재시작하세요. CLI 와 데스크톱 앱은 같은 설정 파일을 쓰므로 한 번 등록하면 둘 다
            적용됩니다. 에이전트에게 "StyleStudio 아이콘 세션으로 이 무기 목록 40개를 4x4 그리드로 뽑아줘" 처럼
            요청하면 됩니다. 실행 전 견적(dry run)을 먼저 확인하도록 안내돼 있습니다.
          </p>
          {status?.serverCommand && (
            <p className="text-[11px] text-gray-400 break-all">실행 명령: {status.serverCommand}</p>
          )}
        </div>
      )}
    </div>
  );
});
