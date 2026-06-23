/**
 * Compute tile layout for a rectangular room.
 * All dimensions in centimeters.
 *
 * @param {object} params
 * @param {number} params.roomWidth
 * @param {number} params.roomLength
 * @param {number} params.panelWidth   - panel width as specified (before rotation)
 * @param {number} params.panelLength  - panel length as specified (before rotation)
 * @param {0|90} params.orientation    - 90 swaps panel width/length for the grid
 * @param {number} params.offsetWidth  - width of left-edge cut panel (0 = flush start)
 * @param {number} params.offsetLength - height of top-edge cut panel (0 = flush start)
 * @param {boolean} [params.alternating] - odd rows/columns reverse start direction
 *   (horizontal at 0°, vertical at 90°)
 */
export function computeLayout({
  roomWidth,
  roomLength,
  panelWidth,
  panelLength,
  orientation,
  offsetWidth,
  offsetLength,
  alternating = false,
}) {
  const tileW = orientation === 90 ? panelLength : panelWidth;
  const tileL = orientation === 90 ? panelWidth : panelLength;

  const columns = buildAxisSegments(roomWidth, tileW, offsetWidth);
  const rows = buildAxisSegments(roomLength, tileL, offsetLength);

  const panels = [];
  let fullCount = 0;
  let cutCount = 0;

  const mirrorHorizontally = alternating && orientation === 0;
  const mirrorVertically = alternating && orientation === 90;

  for (const row of rows) {
    const flipRow = mirrorHorizontally && row.index % 2 === 1;

    for (const col of columns) {
      const flipCol = mirrorVertically && col.index % 2 === 1;
      const isFull = col.isFull && row.isFull;
      if (isFull) fullCount++;
      else cutCount++;

      panels.push({
        x: flipRow ? roomWidth - col.start - col.size : col.start,
        y: flipCol ? roomLength - row.start - row.size : row.start,
        width: col.size,
        height: row.size,
        isFull,
        colIndex: col.index,
        rowIndex: row.index,
        colEdge: flipRow ? mirrorAxisEdge(col.edge) : col.edge,
        rowEdge: flipCol ? mirrorAxisEdge(row.edge) : row.edge,
        rowDirection: flipRow ? 'rtl' : flipCol ? 'btt' : orientation === 90 ? 'ttb' : 'ltr',
      });
    }
  }

  const roomArea = roomWidth * roomLength;
  const panelArea = panels.reduce((sum, p) => sum + p.width * p.height, 0);
  const wasteArea = Math.max(0, panelArea - roomArea);

  const fullPanelArea = tileW * tileL;
  const materialPanels =
    fullCount + panels.filter((p) => !p.isFull).reduce((sum, p) => sum + p.width * p.height, 0) / fullPanelArea;

  return {
    roomWidth,
    roomLength,
    tileW,
    tileL,
    orientation,
    alternating,
    columns,
    rows,
    panels,
    stats: {
      fullCount,
      cutCount,
      totalPanels: panels.length,
      columns: columns.length,
      rows: rows.length,
      leftCut: findEdgeCut(columns, 'start'),
      rightCut: findEdgeCut(columns, 'end'),
      topCut: findEdgeCut(rows, 'start'),
      bottomCut: findEdgeCut(rows, 'end'),
      roomArea,
      panelArea,
      coveragePercent: roomArea > 0 ? (roomArea / panelArea) * 100 : 0,
      materialPanels: Math.ceil(
        panels.reduce((sum, p) => sum + (p.width * p.height) / fullPanelArea, 0) * 100
      ) / 100,
      wasteArea,
    },
  };
}

/**
 * Build segments along one axis.
 * @param {number} roomSize - total room dimension along this axis
 * @param {number} tileSize - full panel dimension along this axis
 * @param {number} startCut - size of first (start-edge) cut panel; 0 = flush with full tile
 */
function buildAxisSegments(roomSize, tileSize, startCut) {
  if (roomSize <= 0 || tileSize <= 0) return [];

  const segments = [];
  let pos = 0;
  let index = 0;

  // Optional leading cut at the start edge
  if (startCut > 0) {
    const cut = Math.min(startCut, roomSize);
    segments.push(makeSegment(pos, cut, tileSize, index++, 'start', false));
    pos += cut;
  }

  // Full tiles while they fit entirely
  while (pos + tileSize <= roomSize + 1e-9) {
    segments.push(makeSegment(pos, tileSize, tileSize, index++, null, true));
    pos += tileSize;
  }

  // Trailing cut on the end edge
  const remaining = roomSize - pos;
  if (remaining > 1e-6) {
    segments.push(makeSegment(pos, remaining, tileSize, index++, 'end', false));
  }

  return segments;
}

function makeSegment(start, size, tileSize, index, edge, isFull) {
  const tolerance = 0.05;
  const full = isFull && Math.abs(size - tileSize) < tolerance;
  return { start, size, index, edge: full ? null : edge, isFull: full };
}

function mirrorAxisEdge(edge) {
  if (edge === 'start') return 'end';
  if (edge === 'end') return 'start';
  return edge;
}

function findEdgeCut(segments, edge) {
  const seg = segments.find((s) => s.edge === edge && !s.isFull);
  return seg ? { size: round(seg.size), index: seg.index } : null;
}

function round(n) {
  return Math.round(n * 10) / 10;
}

export function formatCm(value) {
  return Number.isInteger(value) ? `${value}` : value.toFixed(1);
}
