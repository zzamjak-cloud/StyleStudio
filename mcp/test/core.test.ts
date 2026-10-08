/**
 * MCP 배치 핵심 로직 테스트 (API 호출 없음) — `bun test mcp/test`
 */
import { describe, expect, test } from 'bun:test';

import { cellListBlock, composePrompt, packItems, smallestGridFor } from '../src/prompt';
import { splitCells } from '../src/output';
import { extractCost } from '../src/costlog';
import { decodeImage, encodeJpegOnWhite, encodePng, sniffMime, upscaleNearest, downscale, type RgbaImage } from '../src/imageio';

function solid(width: number, height: number, rgba: [number, number, number, number]): RgbaImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) data.set(rgba, i);
  return { width, height, data };
}

describe('그리드 패킹', () => {
  test('항목 수에 맞는 가장 작은 그리드를 고른다', () => {
    expect(smallestGridFor(1, '4x4')).toBe('1x1');
    expect(smallestGridFor(4, '4x4')).toBe('2x2');
    expect(smallestGridFor(5, '4x4')).toBe('3x3');
    expect(smallestGridFor(16, '4x4')).toBe('4x4');
  });

  test('40개를 4x4 상한으로 묶으면 16·16·8 → 4x4·4x4·3x3', () => {
    const items = Array.from({ length: 40 }, (_, i) => `item${i}`);
    const chunks = packItems(items, '4x4');
    expect(chunks.map((c) => c.grid)).toEqual(['4x4', '4x4', '3x3']);
    expect(chunks.map((c) => c.items.length)).toEqual([16, 16, 8]);
    expect(chunks.flatMap((c) => c.items)).toEqual(items);
  });

  test('빈 셀은 비우라고 명시한다', () => {
    const block = cellListBlock(['a', 'b', 'c'], '2x2');
    expect(block).toContain('Cell 1 (row 1, col 1): a');
    expect(block).toContain('Cell 3 (row 2, col 1): c');
    expect(block).toContain('Cells 4-4: leave completely empty');
  });
});

describe('프롬프트 조립', () => {
  const base = { grid: '2x2' as const, transparentBackground: false };

  test('참조가 있으면 앱 세션 템플릿을 한 번만 씌운다', () => {
    const prompt = composePrompt({ ...base, sessionType: 'ICON', items: ['sword', 'shield'], hasReferenceImages: true });
    expect(prompt.match(/ICON SET/g)?.length).toBe(1);
    expect(prompt).toContain('Cell 2 (row 1, col 2): shield');
    expect(prompt).toContain('Match icon style from reference images');
  });

  test('참조가 없으면 MCP 래퍼로 그리드·배경 지시를 붙인다', () => {
    const prompt = composePrompt({ ...base, sessionType: 'ICON', items: ['sword'], hasReferenceImages: false, styleText: 'cute cartoon' });
    expect(prompt).toContain('2x2 grid');
    expect(prompt).toContain('NO GRID LINES');
    expect(prompt).toContain('Pure white background');
    expect(prompt).toContain('STYLE');
    expect(prompt).not.toContain('reference images');
  });

  test('투명 배경이면 순백 배경 지시를 알파 지시로 바꾼다', () => {
    const prompt = composePrompt({ ...base, sessionType: 'ICON', items: ['gem'], hasReferenceImages: true, transparentBackground: true });
    expect(prompt).not.toContain('Pure white background');
    expect(prompt).toContain('Fully transparent background');
  });

  test('픽셀 세션은 최신 픽셀 채색 규칙이 한 번만 들어간다', () => {
    const prompt = composePrompt({ ...base, sessionType: 'PIXELART_ICON', items: ['coin'], hasReferenceImages: true });
    expect(prompt.match(/MODERN PIXEL ART SHADING/g)?.length).toBe(1);
  });

  test('네거티브는 분석과 사용자 지정을 합쳐 Avoid 로 붙인다', () => {
    const prompt = composePrompt({
      ...base,
      sessionType: 'STYLE',
      prompt: 'castle',
      grid: '1x1',
      hasReferenceImages: false,
      analysis: { negative_prompt: 'blurry' } as never,
      negativePrompt: 'text',
    });
    expect(prompt.endsWith('Avoid: blurry, text')).toBe(true);
  });

  test('BASIC 은 원문 그대로', () => {
    expect(composePrompt({ ...base, sessionType: 'BASIC', prompt: 'hello', grid: '1x1', hasReferenceImages: false })).toBe('hello');
  });
});

describe('이미지 입출력', () => {
  test('PNG 왕복', () => {
    const img = solid(3, 2, [10, 20, 30, 128]);
    const bytes = encodePng(img);
    expect(sniffMime(bytes)).toBe('image/png');
    const back = decodeImage(bytes);
    expect([back.width, back.height]).toEqual([3, 2]);
    expect(Array.from(back.data.slice(0, 4))).toEqual([10, 20, 30, 128]);
  });

  test('JPEG 는 흰 배경에 합성된다', () => {
    const bytes = encodeJpegOnWhite(solid(8, 8, [0, 0, 0, 0]));
    expect(sniffMime(bytes)).toBe('image/jpeg');
    const back = decodeImage(bytes);
    expect(back.data[0]).toBeGreaterThan(245);
  });

  test('셀 분할은 균등하다', () => {
    const cells = splitCells(solid(1024, 1024, [1, 2, 3, 255]), '4x4');
    expect(cells.length).toBe(16);
    expect(cells.every((c) => c.width === 256 && c.height === 256)).toBe(true);
  });

  test('정수배 확대·면적 축소', () => {
    expect(upscaleNearest(solid(2, 3, [0, 0, 0, 255]), 4)).toMatchObject({ width: 8, height: 12 });
    expect(downscale(solid(2000, 1000, [0, 0, 0, 255]), 1280)).toMatchObject({ width: 1280, height: 640 });
  });
});

describe('비용 추출', () => {
  test('BYOK 는 업스트림 비용을 더한다 (실측 응답 형식)', () => {
    expect(
      extractCost({ cost: 0, is_byok: true, cost_details: { upstream_inference_cost: 0.006175 } })
    ).toBeCloseTo(0.006175);
  });
  test('일반 계정은 cost 그대로', () => {
    expect(extractCost({ cost: 0.04 })).toBeCloseTo(0.04);
  });
  test('정보가 없으면 undefined', () => {
    expect(extractCost({})).toBeUndefined();
    expect(extractCost(undefined)).toBeUndefined();
  });
});

// ───────────────────────── 계획 단계 회귀 (리뷰 지적) ─────────────────────────
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { PLAN_HARD_LIMIT, planGeneratorBatch } from '../src/batch';
import { summarizePlan } from '../src/engine';
import { planIllustrationReferences } from '../src/illustration';
import { buildConceptBasePrompt } from '../../src/lib/prompts/conceptPrompt';
import { buildChatConversationContext, buildChatSettingsPrefix, composeChatPrompt } from '../../src/lib/prompts/chatPrompt';
import { assertWritable, isInside, sanitizeName } from '../src/env';

describe('배치 계획', () => {
  // settings.json 이 없는 임시 폴더를 앱 데이터 폴더로 쓴다 (session_id 를 안 쓰면 읽지 않는다)
  const dataDir = mkdtempSync(join(tmpdir(), 'ss-data-'));
  const outDir = mkdtempSync(join(tmpdir(), 'ss-out-'));
  const plan = (input: Record<string, unknown>) =>
    planGeneratorBatch(dataDir, { session_type: 'ICON', dest_dir: outDir, ...input } as never);
  const summary = async (input: Record<string, unknown>) => {
    const p = await plan(input);
    return summarizePlan(p.model, p.units);
  };

  test('count 가 커도 계획 단계에서 즉시 끊는다 (서버 폭주 방지)', async () => {
    await expect(plan({ tasks: [{ prompt: 'x', count: 1e9 }], options: { model: 'google/gemini-3.1-flash-image-preview' } })).rejects.toThrow(
      String(PLAN_HARD_LIMIT)
    );
  });

  test('gpt 계열은 count 를 요청당 10장(n)으로 나눈다', async () => {
    const p = await plan({ tasks: [{ prompt: 'x', count: 23 }] });
    expect(p.units.map((u) => u.call.n)).toEqual([10, 10, 3]);
    expect((await summary({ tasks: [{ prompt: 'x', count: 23 }] })).images).toBe(23);
  });

  test('items 와 count 를 함께 주거나 빈 items 면 거부', async () => {
    await expect(plan({ tasks: [{ items: ['a'], count: 2 }] })).rejects.toThrow('함께');
    await expect(plan({ tasks: [{ items: ['  ', ''] }] })).rejects.toThrow('빈 문자열');
  });

  test('expected_files 는 시트와 픽셀 확대본까지 센다', async () => {
    const items = Array.from({ length: 40 }, (_, i) => `i${i}`);
    expect((await summary({ tasks: [{ items }] })).expectedFiles).toBe(43); // 셀 40 + 시트 3
    const pixel = await planGeneratorBatch(dataDir, { session_type: 'PIXELART_ICON', dest_dir: outDir, tasks: [{ items }] } as never);
    expect(summarizePlan(pixel.model, pixel.units).expectedFiles).toBe(83); // 셀 40 × (논리+확대) + 시트 3
  });

  test('출력이 앱 데이터 폴더 안이면 거부 — task 이름으로 우회하는 경우까지', async () => {
    await expect(plan({ dest_dir: join(dataDir, 'images'), tasks: [{ prompt: 'x' }] })).rejects.toThrow('앱 데이터');
    await expect(
      planGeneratorBatch(dataDir, {
        session_type: 'ICON',
        dest_dir: join(dataDir, '..'),
        tasks: [{ name: basename(dataDir), prompt: 'x' }],
      } as never)
    ).rejects.toThrow('앱 데이터');
  });

  test('프롬프트는 단위마다 템플릿 1회 + 셀 목록', async () => {
    const p = await plan({ tasks: [{ items: ['sword', 'shield'] }], style: { style_text: 'cartoon' } });
    const prompt = p.units[0].buildPrompt!((t) => t);
    expect(prompt.match(/ICONS SET|ICON SET/g)?.length).toBe(1);
    expect(prompt).toContain('Cell 2 (row 1, col 2): shield');
  });
});

describe('일러스트 참조 배분', () => {
  const chars = (n: number, each: number) =>
    Array.from({ length: n }, (_, i) => ({ name: `c${i}`, images: Array.from({ length: each }, (_, j) => `c${i}-${j}`) }));

  test('상한 안이면 앱 순서 그대로 [캐릭터, 배경, 스케치]', () => {
    const r = planIllustrationReferences(chars(2, 2), ['bg0'], 'sketch', 16);
    expect(r.references).toEqual(['c0-0', 'c0-1', 'c1-0', 'c1-1', 'bg0', 'sketch']);
    expect(r.dropped).toBe(0);
    expect(r.map).toContain('character "c1"');
  });

  test('상한을 넘으면 스케치를 지키고 캐릭터당 최소 1장을 보장한다 (앱은 스케치가 먼저 잘림)', () => {
    const r = planIllustrationReferences(chars(5, 3), ['b0', 'b1', 'b2', 'b3', 'b4'], 'sketch', 14);
    expect(r.references.length).toBe(14);
    expect(r.references[r.references.length - 1]).toBe('sketch');
    for (let i = 0; i < 5; i++) expect(r.references).toContain(`c${i}-0`);
    expect(r.dropped).toBe(21 - 14);
  });
});

describe('공유 프롬프트 (앱과 같은 소스)', () => {
  test('컨셉 자동 구성 + 그리드 베리에이션', () => {
    expect(
      buildConceptBasePrompt({ gameGenres: ['퍼즐'], gamePlayStyle: '매치3', referenceGames: [], artStyles: ['카툰 렌더'], grid: '2x2' })
    ).toBe('퍼즐 게임 컨셉 아트, 게임 플레이: 매치3, 카툰 렌더 아트 스타일, 4개의 다양한 베리에이션');
    expect(buildConceptBasePrompt({ gameGenres: [], artStyles: [], grid: '1x1' })).toBe('모바일 게임 컨셉 아트');
  });

  test('채팅: 대화 맥락은 내용 있는 메시지 최근 6턴, prefix·문서 요약 결합', () => {
    const messages = Array.from({ length: 8 }, (_, i) => ({
      id: String(i),
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: i % 2 === 0 ? `지시 ${i}` : '',
      timestamp: '',
    })) as never;
    const context = buildChatConversationContext(undefined, messages);
    expect(context).toContain('사용자: 지시 6');
    expect(context).not.toContain('AI:'); // 빈 assistant 메시지는 빠진다 (앱과 동일)
    const prompt = composeChatPrompt({
      conversationContext: context,
      settingsPrefix: buildChatSettingsPrefix({ pixelArtGrid: '2x2', pixelArtMode: true }),
      userMessage: '모자를 씌워줘',
      documents: [{ fileName: 'a.md', content: '기획', summary: '요약본' } as never],
    });
    expect(prompt).toContain('[그리드 레이아웃: 2x2');
    expect(prompt).toContain('PIXEL ART MODE');
    expect(prompt).toContain('[첨부 문서 핵심 요약: a.md]\n요약본');
    expect(prompt.endsWith('모자를 씌워줘')).toBe(true);
  });
});

describe('경로 보호', () => {
  test('형제 폴더는 내부로 보지 않는다 (문자열 접두사 오탐 방지)', () => {
    const base = mkdtempSync(join(tmpdir(), 'ss-base-'));
    expect(isInside(join(base, 'a', 'b.json'), base)).toBe(true);
    expect(isInside(`${base}-exports`, base)).toBe(false);
    expect(() => assertWritable(join(base, 'settings.json'), base)).toThrow();
  });

  test('Windows 예약 이름은 피한다', () => {
    expect(sanitizeName('CON', 'x')).toBe('CON_');
    expect(sanitizeName('a/b:c', 'x')).toBe('a_b_c');
  });
});
