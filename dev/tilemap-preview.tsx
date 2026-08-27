/**
 * 타일 배치 미리보기 캔버스 dev 하네스 (프로덕션 번들 미포함).
 *
 * 실행: `npm run dev` 후 http://localhost:1420/dev/tilemap-preview.html
 *
 * 합성 재질로 룰타일 세트를 만들어 `TilePreviewCanvas`를 그대로 띄운다.
 * 패닝·Alt 지우기·줌 같은 상호작용은 코드를 읽어서는 검증할 수 없으므로 실제로 조작해 본다.
 */
import { createRoot } from 'react-dom/client';
import { useEffect, useState } from 'react';
import { TilePreviewCanvas } from '../src/components/tilemap/TilePreviewCanvas';
import { buildRuleTileSet } from '../src/lib/tilemap/ruleTileComposer';
import { TilemapEdgeStyle } from '../src/types/tilemap';
import { TILEMAP_EDGE_STYLES } from '../src/lib/tilemap/edgeStyles';

/** 잔디/흙 느낌의 합성 머티리얼 시트 (좌=베이스, 우=오버레이) */
function makeSheet(): string {
  const S = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(S, S);
  const noise = (x: number, y: number, seed: number) => {
    let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
  };
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const t = noise(x >> 2, y >> 2, 5) * 0.6 + noise(x, y, 17) * 0.4;
      const i = (y * S + x) * 4;
      const c = x < S / 2
        ? [58 + t * 30, 104 + t * 38, 52 + t * 26]
        : [186 + t * 34, 154 + t * 32, 104 + t * 28];
      img.data[i] = c[0];
      img.data[i + 1] = c[1];
      img.data[i + 2] = c[2];
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL('image/png');
}

function Harness() {
  const [tiles, setTiles] = useState<string[] | null>(null);
  const [baseTile, setBaseTile] = useState<string | null>(null);
  const [style, setStyle] = useState<TilemapEdgeStyle>('blades');

  useEffect(() => {
    let cancelled = false;
    setTiles(null);
    (async () => {
      const set = await buildRuleTileSet(makeSheet(), '8x8', {
        edgeStyle: style,
        outline: { enabled: true, thicknessPx: 3, color: '#3b2f2a' },
      });
      if (cancelled) return;
      setTiles(set.tiles);
      setBaseTile(set.baseTile);
    })();
    return () => { cancelled = true; };
  }, [style]);

  if (!tiles) {
    return <div style={{ padding: 24, font: '14px monospace' }}>합성 중… ({style})</div>;
  }
  return (
    <>
      <div style={{ position: 'fixed', top: 8, left: 8, zIndex: 100, font: '12px monospace' }}>
        <select value={style} onChange={(e) => setStyle(e.target.value as TilemapEdgeStyle)}>
          {TILEMAP_EDGE_STYLES.map((s) => (
            <option key={s.id} value={s.id}>{s.label}</option>
          ))}
        </select>
      </div>
      <TilePreviewCanvas
        tiles={tiles}
        mode="ruletile"
        grid="8x8"
        baseTile={baseTile}
        onClose={() => { /* 하네스에서는 닫지 않는다 */ }}
      />
    </>
  );
}

createRoot(document.getElementById('root')!).render(<Harness />);
