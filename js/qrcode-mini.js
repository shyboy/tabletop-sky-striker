/**
 * Minimal Pure-JS Offline QR Code SVG Generator (ISO/IEC 18004 Byte Mode, ECC Level L, Versions 1-8)
 * Zero external dependencies. Supports offline LAN & static hosting.
 */
(function (global) {
  'use strict';

  // Total codewords and EC codewords per single block (Versions 1..8 at Level L all use 1 block!)
  // Wait: Version 6-L uses 2 blocks! Let's check exact ISO/IEC 18004 Table 9 for Level L:
  // V1-L: total 26, data 19, ec 7, blocks 1
  // V2-L: total 44, data 34, ec 10, blocks 1
  // V3-L: total 70, data 55, ec 15, blocks 1
  // V4-L: total 100, data 80, ec 20, blocks 1
  // V5-L: total 134, data 108, ec 26, blocks 1
  // V6-L: total 172, data 136, ec 18*2 (2 blocks: each 68 data, 18 ec)
  // V7-L: total 196, data 156, ec 20*2 (2 blocks: each 78 data, 20 ec)
  // V8-L: total 242, data 194, ec 24*2 (2 blocks: each 97 data, 24 ec)
  const VERSION_SPEC_L = [
    null,
    { size: 21, dataBytes: 19, ecPerBlock: 7, blocks: 1, align: [] },
    { size: 25, dataBytes: 34, ecPerBlock: 10, blocks: 1, align: [6, 18] },
    { size: 29, dataBytes: 55, ecPerBlock: 15, blocks: 1, align: [6, 22] },
    { size: 33, dataBytes: 80, ecPerBlock: 20, blocks: 1, align: [6, 26] },
    { size: 37, dataBytes: 108, ecPerBlock: 26, blocks: 1, align: [6, 30] },
    { size: 41, dataBytes: 136, ecPerBlock: 18, blocks: 2, align: [6, 34] },
    { size: 45, dataBytes: 156, ecPerBlock: 20, blocks: 2, align: [6, 22, 38] },
    { size: 49, dataBytes: 194, ecPerBlock: 24, blocks: 2, align: [6, 24, 42] }
  ];

  // GF(256) with primitive polynomial 0x11D
  const EXP = new Uint8Array(512);
  const LOG = new Uint8Array(256);
  (function initGF() {
    let x = 1;
    for (let i = 0; i < 255; i++) {
      EXP[i] = x;
      LOG[x] = i;
      x <<= 1;
      if (x & 0x100) x ^= 0x11d;
    }
    for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
  })();

  function gfMul(a, b) {
    if (a === 0 || b === 0) return 0;
    return EXP[LOG[a] + LOG[b]];
  }

  function polyMul(p, q) {
    const out = new Uint8Array(p.length + q.length - 1);
    for (let i = 0; i < p.length; i++) {
      for (let j = 0; j < q.length; j++) {
        out[i + j] ^= gfMul(p[i], q[j]);
      }
    }
    return out;
  }

  function rsGeneratorPoly(degree) {
    let g = new Uint8Array([1]);
    for (let i = 0; i < degree; i++) {
      g = polyMul(g, new Uint8Array([1, EXP[i]]));
    }
    return g;
  }

  function rsComputeRemainder(data, degree) {
    const gen = rsGeneratorPoly(degree);
    const rem = new Uint8Array(degree);
    for (let i = 0; i < data.length; i++) {
      const factor = data[i] ^ rem[0];
      rem.copyWithin(0, 1);
      rem[degree - 1] = 0;
      if (factor !== 0) {
        for (let j = 0; j < degree; j++) {
          rem[j] ^= gfMul(gen[j + 1], factor);
        }
      }
    }
    return rem;
  }

  function encodeData(text) {
    const utf8 = new TextEncoder().encode(text);
    let ver = 1;
    while (ver <= 8) {
      // Byte mode header: 4 bits mode (0100) + 8 bits length (V1..9) = 12 bits -> max payload = dataBytes - 2
      if (utf8.length + 2 <= VERSION_SPEC_L[ver].dataBytes) break;
      ver++;
    }
    if (ver > 8) throw new Error('QR text too long for mini encoder (max ~192 bytes)');

    const spec = VERSION_SPEC_L[ver];
    const bits = [];
    const pushBits = (val, len) => {
      for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1);
    };

    pushBits(0b0100, 4); // Byte mode
    pushBits(utf8.length, 8); // Character count (8 bits for V1-9)
    for (let i = 0; i < utf8.length; i++) pushBits(utf8[i], 8);

    const maxBits = spec.dataBytes * 8;
    const terminator = Math.min(4, maxBits - bits.length);
    pushBits(0, terminator);
    while (bits.length % 8 !== 0) bits.push(0);

    const dataCodewords = new Uint8Array(spec.dataBytes);
    for (let i = 0; i < bits.length / 8; i++) {
      let b = 0;
      for (let j = 0; j < 8; j++) b = (b << 1) | bits[i * 8 + j];
      dataCodewords[i] = b;
    }
    const pads = [0xec, 0x11];
    for (let i = bits.length / 8, p = 0; i < spec.dataBytes; i++, p ^= 1) {
      dataCodewords[i] = pads[p];
    }

    // Split into blocks and compute RS error correction
    const dataPerBlock = spec.dataBytes / spec.blocks;
    const dataBlocks = [];
    const ecBlocks = [];
    for (let b = 0; b < spec.blocks; b++) {
      const slice = dataCodewords.slice(b * dataPerBlock, (b + 1) * dataPerBlock);
      dataBlocks.push(slice);
      ecBlocks.push(rsComputeRemainder(slice, spec.ecPerBlock));
    }

    const finalCodewords = [];
    for (let i = 0; i < dataPerBlock; i++) {
      for (let b = 0; b < spec.blocks; b++) finalCodewords.push(dataBlocks[b][i]);
    }
    for (let i = 0; i < spec.ecPerBlock; i++) {
      for (let b = 0; b < spec.blocks; b++) finalCodewords.push(ecBlocks[b][i]);
    }

    return { ver, spec, codewords: finalCodewords };
  }

  function buildBaseMatrix(ver, spec) {
    const n = spec.size;
    const modules = Array.from({ length: n }, () => new Uint8Array(n));
    const isFunc = Array.from({ length: n }, () => new Uint8Array(n));

    const setFunc = (r, c, dark) => {
      if (r < 0 || r >= n || c < 0 || c >= n) return;
      modules[r][c] = dark ? 1 : 0;
      isFunc[r][c] = 1;
    };

    const drawFinder = (topR, leftC) => {
      for (let dr = -1; dr <= 7; dr++) {
        for (let dc = -1; dc <= 7; dc++) {
          const rr = topR + dr;
          const cc = leftC + dc;
          const inOuter = dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6;
          const onBorder = dr === 0 || dr === 6 || dc === 0 || dc === 6;
          const inInner = dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4;
          setFunc(rr, cc, inOuter && (onBorder || inInner));
        }
      }
    };

    drawFinder(0, 0);
    drawFinder(0, n - 7);
    drawFinder(n - 7, 0);

    // Timing patterns
    for (let i = 8; i < n - 8; i++) {
      const dark = i % 2 === 0;
      setFunc(6, i, dark);
      setFunc(i, 6, dark);
    }

    // Alignment patterns
    const align = spec.align;
    for (let i = 0; i < align.length; i++) {
      for (let j = 0; j < align.length; j++) {
        if ((i === 0 && j === 0) || (i === 0 && j === align.length - 1) || (i === align.length - 1 && j === 0)) {
          continue;
        }
        const cr = align[i];
        const cc = align[j];
        for (let dr = -2; dr <= 2; dr++) {
          for (let dc = -2; dc <= 2; dc++) {
            const dark = Math.max(Math.abs(dr), Math.abs(dc)) !== 1;
            setFunc(cr + dr, cc + dc, dark);
          }
        }
      }
    }

    // Dark module & Reserve format info areas
    setFunc(n - 8, 8, true);
    for (let i = 0; i <= 8; i++) {
      if (i !== 6) {
        if (!isFunc[8][i]) setFunc(8, i, false);
        if (!isFunc[i][8]) setFunc(i, 8, false);
      }
    }
    for (let i = 0; i < 8; i++) {
      setFunc(8, n - 1 - i, false);
      setFunc(n - 1 - i, 8, false);
    }

    // Version info for V >= 7
    if (ver >= 7) {
      let rem = ver;
      for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
      const vBits = (ver << 12) | rem;
      for (let i = 0; i < 18; i++) {
        const bit = ((vBits >>> i) & 1) !== 0;
        const a = n - 11 + (i % 3);
        const b = Math.floor(i / 3);
        setFunc(a, b, bit);
        setFunc(b, a, bit);
      }
    }

    return { modules, isFunc };
  }

  function placeCodewords(modules, isFunc, codewords) {
    const n = modules.length;
    let bitIdx = 0;
    const totalBits = codewords.length * 8;
    let upward = true;

    for (let right = n - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5; // Skip vertical timing column
      for (let vert = 0; vert < n; vert++) {
        const r = upward ? n - 1 - vert : vert;
        for (let j = 0; j < 2; j++) {
          const c = right - j;
          if (!isFunc[r][c]) {
            let dark = 0;
            if (bitIdx < totalBits) {
              dark = (codewords[bitIdx >>> 3] >>> (7 - (bitIdx & 7))) & 1;
              bitIdx++;
            }
            modules[r][c] = dark;
          }
        }
      }
      upward = !upward;
    }
  }

  function drawFormatBits(modules, mask) {
    const n = modules.length;
    // ECC Level L = 01
    const data = (0b01 << 3) | mask;
    let rem = data;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const bits = ((data << 10) | rem) ^ 0x5412;

    const bit = (i) => (bits >>> i) & 1;

    // First copy around top-left (ISO/IEC 18004 Fig. 25: bit 0 at (0,8) .. bit 14 at (8,0))
    for (let i = 0; i <= 5; i++) modules[i][8] = bit(i);
    modules[7][8] = bit(6);
    modules[8][8] = bit(7);
    modules[8][7] = bit(8);
    for (let i = 9; i < 15; i++) modules[8][14 - i] = bit(i);

    // Second copy (bit 0..7 on row 8 right edge, bit 8..14 on col 8 bottom edge)
    for (let i = 0; i < 8; i++) modules[8][n - 1 - i] = bit(i);
    for (let i = 8; i < 15; i++) modules[n - 15 + i][8] = bit(i);
    modules[n - 8][8] = 1;
  }

  const MASKS = [
    (r, c) => (r + c) % 2 === 0,
    (r, _) => r % 2 === 0,
    (_, c) => c % 3 === 0,
    (r, c) => (r + c) % 3 === 0,
    (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
    (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
    (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
    (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0
  ];

  function penaltyScore(m) {
    const n = m.length;
    let score = 0;
    // Rule 1: 5+ consecutive in row/col
    for (let r = 0; r < n; r++) {
      let runR = 1, runC = 1;
      for (let c = 1; c < n; c++) {
        if (m[r][c] === m[r][c - 1]) {
          runR++;
          if (runR === 5) score += 3;
          else if (runR > 5) score += 1;
        } else runR = 1;

        if (m[c][r] === m[c - 1][r]) {
          runC++;
          if (runC === 5) score += 3;
          else if (runC > 5) score += 1;
        } else runC = 1;
      }
    }
    // Rule 2: 2x2 blocks
    for (let r = 0; r < n - 1; r++) {
      for (let c = 0; c < n - 1; c++) {
        const v = m[r][c];
        if (v === m[r][c + 1] && v === m[r + 1][c] && v === m[r + 1][c + 1]) score += 3;
      }
    }
    return score;
  }

  function generateMatrix(text) {
    const { ver, spec, codewords } = encodeData(text);
    const { modules: base, isFunc } = buildBaseMatrix(ver, spec);
    placeCodewords(base, isFunc, codewords);

    let bestMatrix = null;
    let bestScore = Infinity;

    for (let mask = 0; mask < 8; mask++) {
      const copy = base.map((row) => Uint8Array.from(row));
      const fn = MASKS[mask];
      for (let r = 0; r < spec.size; r++) {
        for (let c = 0; c < spec.size; c++) {
          if (!isFunc[r][c] && fn(r, c)) copy[r][c] ^= 1;
        }
      }
      drawFormatBits(copy, mask);
      const s = penaltyScore(copy);
      if (s < bestScore) {
        bestScore = s;
        bestMatrix = copy;
      }
    }
    return bestMatrix;
  }

  function renderQRSVG(text, options = {}) {
    const matrix = generateMatrix(text);
    const n = matrix.length;
    const margin = options.margin ?? 2;
    const total = n + margin * 2;
    const dark = options.dark || '#0f172a';
    const light = options.light || '#ffffff';

    let path = '';
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (matrix[r][c]) {
          path += `M${c + margin},${r + margin}h1v1h-1z`;
        }
      }
    }

    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges" role="img" aria-label="手机扫码连接控制器"><rect width="${total}" height="${total}" fill="${light}" rx="1.5"/><path d="${path}" fill="${dark}"/></svg>`;
  }

  global.MiniQR = { generateMatrix, renderQRSVG };
})(typeof window !== 'undefined' ? window : globalThis);
