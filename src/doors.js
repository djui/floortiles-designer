/** Door overlay helpers — overlays only, no layout impact. */

export const DEFAULT_DOOR_WIDTH = 70;
export const MIN_DOOR_WIDTH = 40;
export const MAX_DOOR_WIDTH = 150;
export const DOOR_WIDTH = DEFAULT_DOOR_WIDTH; // legacy alias

export const WALLS = ['top', 'right', 'bottom', 'left'];
export const HINGE_SIDES = ['start', 'end'];

export const WALL_LABELS = {
  top: 'Top',
  right: 'Right',
  bottom: 'Bottom',
  left: 'Left',
};

export function getDoorWidth(door) {
  const w = Number(door.width);
  if (!Number.isFinite(w)) return DEFAULT_DOOR_WIDTH;
  return Math.min(MAX_DOOR_WIDTH, Math.max(MIN_DOOR_WIDTH, w));
}

export function createDoor(overrides = {}) {
  return {
    id: crypto.randomUUID(),
    wall: 'top',
    position: 0,
    width: DEFAULT_DOOR_WIDTH,
    facing: 'inward',
    hingeSide: 'start',
    ...overrides,
  };
}

export function getWallLength(wall, roomWidth, roomLength) {
  if (wall === 'top' || wall === 'bottom') return roomWidth;
  return roomLength;
}

export function clampDoorPosition(door, roomWidth, roomLength) {
  const wallLen = getWallLength(door.wall, roomWidth, roomLength);
  const half = getDoorWidth(door) / 2;
  const maxPos = Math.max(half, wallLen - half);
  return Math.min(maxPos, Math.max(half, door.position));
}

export function normalizeDoor(door, roomWidth, roomLength) {
  const wall = WALLS.includes(door.wall) ? door.wall : 'top';
  const facing = door.facing === 'outward' ? 'outward' : 'inward';
  const hingeSide = door.hingeSide === 'end' ? 'end' : 'start';
  const width = getDoorWidth(door);
  const wallLen = getWallLength(wall, roomWidth, roomLength);
  const half = width / 2;
  const defaultPos = wallLen / 2;

  return {
    id: door.id || crypto.randomUUID(),
    wall,
    position: clampDoorPosition(
      { wall, position: Number(door.position) || defaultPos, width },
      roomWidth,
      roomLength
    ),
    width,
    facing,
    hingeSide,
  };
}

export function normalizeDoors(doors, roomWidth, roomLength) {
  if (!Array.isArray(doors)) return [];
  return doors.map((d) => normalizeDoor(d, roomWidth, roomLength));
}

/** Room-space (cm) center of the door on its wall edge. */
export function doorCenter(door, roomWidth, roomLength) {
  const pos = clampDoorPosition(door, roomWidth, roomLength);
  switch (door.wall) {
    case 'top':
      return { x: pos, y: 0 };
    case 'right':
      return { x: roomWidth, y: pos };
    case 'bottom':
      return { x: pos, y: roomLength };
    case 'left':
      return { x: 0, y: pos };
    default:
      return { x: pos, y: 0 };
  }
}

/**
 * Wall frame in room cm: hinge/free endpoints and interior unit vector.
 * "start" is the left/top end of the opening; "end" is the right/bottom end.
 */
function getWallFrame(wall, pos, half, roomWidth, roomLength, hingeSide = 'start') {
  let frame;

  switch (wall) {
    case 'top':
      frame = {
        start: { x: pos - half, y: 0 },
        end: { x: pos + half, y: 0 },
        ix: 0,
        iy: 1,
        axis: 'x',
      };
      break;
    case 'right':
      frame = {
        start: { x: roomWidth, y: pos - half },
        end: { x: roomWidth, y: pos + half },
        ix: -1,
        iy: 0,
        axis: 'y',
      };
      break;
    case 'bottom':
      frame = {
        start: { x: pos - half, y: roomLength },
        end: { x: pos + half, y: roomLength },
        ix: 0,
        iy: -1,
        axis: 'x',
      };
      break;
    case 'left':
      frame = {
        start: { x: 0, y: pos - half },
        end: { x: 0, y: pos + half },
        ix: 1,
        iy: 0,
        axis: 'y',
      };
      break;
    default:
      frame = {
        start: { x: pos - half, y: 0 },
        end: { x: pos + half, y: 0 },
        ix: 0,
        iy: 1,
        axis: 'x',
      };
  }

  const hinge = hingeSide === 'end' ? frame.end : frame.start;
  const free = hingeSide === 'end' ? frame.start : frame.end;
  return { hinge, free, ix: frame.ix, iy: frame.iy, axis: frame.axis, hingeSide };
}

/** SVG arc from free end to leaf tip around hinge. */
function swingArc(hx, hy, fx, fy, lx, ly) {
  const r = Math.hypot(fx - hx, fy - hy);
  if (r < 0.01) return `M ${fx} ${fy} L ${lx} ${ly}`;

  const cross = (fx - hx) * (ly - hy) - (fy - hy) * (lx - hx);
  const sweep = cross > 0 ? 1 : 0;
  return `M ${fx} ${fy} A ${r} ${r} 0 0 ${sweep} ${lx} ${ly}`;
}

/**
 * Door symbol paths in room coordinates (cm).
 * Inward: leaf swings into room interior; outward: away from room.
 */
export function doorGeometry(door, roomWidth, roomLength) {
  const w = getDoorWidth(door);
  const pos = clampDoorPosition(door, roomWidth, roomLength);
  const half = w / 2;
  const inward = door.facing !== 'outward';
  const hingeSide = door.hingeSide === 'end' ? 'end' : 'start';
  const { hinge, free, ix, iy, axis } = getWallFrame(
    door.wall,
    pos,
    half,
    roomWidth,
    roomLength,
    hingeSide
  );

  const dir = inward ? 1 : -1;
  const leafX = hinge.x + ix * w * dir;
  const leafY = hinge.y + iy * w * dir;

  return {
    w,
    pos,
    axis,
    hinge,
    free,
    leaf: { x: leafX, y: leafY },
    opening: `M ${hinge.x} ${hinge.y} L ${free.x} ${free.y}`,
    leafPath: `M ${hinge.x} ${hinge.y} L ${leafX} ${leafY}`,
    arc: swingArc(hinge.x, hinge.y, free.x, free.y, leafX, leafY),
  };
}

/** Position along wall axis from a room-space point. */
export function positionFromRoomPoint(wall, x, y) {
  if (wall === 'top' || wall === 'bottom') return x;
  return y;
}

/** Clamp position for a given width on a wall. */
export function clampPositionForWidth(wall, position, width, roomWidth, roomLength) {
  const wallLen = getWallLength(wall, roomWidth, roomLength);
  const half = width / 2;
  const maxPos = Math.max(half, wallLen - half);
  return Math.min(maxPos, Math.max(half, position));
}

/** Compute door width when dragging the free-end handle. Hinge stays fixed. */
export function widthFromHandleDrag(door, roomX, roomY, roomWidth, roomLength) {
  const pos = clampDoorPosition(door, roomWidth, roomLength);
  const half = getDoorWidth(door) / 2;
  const { hinge, axis } = getWallFrame(
    door.wall,
    pos,
    half,
    roomWidth,
    roomLength,
    door.hingeSide
  );

  let along;
  if (axis === 'x') {
    along = Math.abs(roomX - hinge.x);
  } else {
    along = Math.abs(roomY - hinge.y);
  }

  return Math.min(MAX_DOOR_WIDTH, Math.max(MIN_DOOR_WIDTH, along));
}

/** Center position after resize with hinge fixed at current hinge location. */
export function positionAfterResize(door, newWidth, roomWidth, roomLength) {
  const pos = clampDoorPosition(door, roomWidth, roomLength);
  const half = getDoorWidth(door) / 2;
  const hingeSide = door.hingeSide === 'end' ? 'end' : 'start';
  const { hinge, axis } = getWallFrame(door.wall, pos, half, roomWidth, roomLength, hingeSide);

  const newHalf = newWidth / 2;
  const sign = hingeSide === 'end' ? -1 : 1;
  let newPos;
  if (axis === 'x') {
    newPos = hinge.x + newHalf * sign;
  } else {
    newPos = hinge.y + newHalf * sign;
  }

  return clampPositionForWidth(door.wall, newPos, newWidth, roomWidth, roomLength);
}

export function renderDoorSvg(door, roomWidth, roomLength, tx, ty, scale, { selected = false } = {}) {
  const geom = doorGeometry(door, roomWidth, roomLength);
  const s = scale;
  const hitPad = 8 / scale;

  const toSvg = (x, y) => `${tx(x)} ${ty(y)}`;
  const [hx, hy] = toSvg(geom.hinge.x, geom.hinge.y).split(' ').map(Number);
  const [fx, fy] = toSvg(geom.free.x, geom.free.y).split(' ').map(Number);
  const [lx, ly] = toSvg(geom.leaf.x, geom.leaf.y).split(' ').map(Number);

  const opening = `M ${hx} ${hy} L ${fx} ${fy}`;
  const leafPath = `M ${hx} ${hy} L ${lx} ${ly}`;
  const arc = swingArc(hx, hy, fx, fy, lx, ly);

  const selectedCls = selected ? ' door-symbol--selected' : '';
  const handleR = 6;

  let handle = '';
  if (selected) {
    handle = `
      <circle
        class="door-resize-handle"
        data-door-id="${door.id}"
        data-action="resize"
        cx="${fx}"
        cy="${fy}"
        r="${handleR}"
      />
    `;
  }

  const minX = Math.min(hx, fx, lx) - hitPad * s;
  const minY = Math.min(hy, fy, ly) - hitPad * s;
  const maxX = Math.max(hx, fx, lx) + hitPad * s;
  const maxY = Math.max(hy, fy, ly) + hitPad * s;

  return `
    <g class="door-symbol${selectedCls}" data-door-id="${door.id}">
      <rect
        class="door-hit"
        data-door-id="${door.id}"
        data-action="move"
        x="${minX}"
        y="${minY}"
        width="${maxX - minX}"
        height="${maxY - minY}"
        fill="transparent"
      />
      <path d="${opening}" class="door-opening" pointer-events="none" />
      <path d="${leafPath}" class="door-leaf" pointer-events="none" />
      <path d="${arc}" class="door-arc" fill="none" pointer-events="none" />
      ${handle}
    </g>
  `;
}

export function renderWallHitZones(
  roomWidth,
  roomLength,
  tx,
  ty,
  scale,
  hitMargin = 14,
  highlightWall = null
) {
  const m = hitMargin / scale;
  const rw = roomWidth;
  const rl = roomLength;

  const zones = [
    { wall: 'top', x: 0, y: -m, w: rw, h: m * 2 },
    { wall: 'right', x: rw - m, y: 0, w: m * 2, h: rl },
    { wall: 'bottom', x: 0, y: rl - m, w: rw, h: m * 2 },
    { wall: 'left', x: -m, y: 0, w: m * 2, h: rl },
  ];

  return zones
    .map((z) => {
      const activeCls = z.wall === highlightWall ? ' door-wall-hit--active' : '';
      return `
    <rect
      class="door-wall-hit${activeCls}"
      data-wall="${z.wall}"
      x="${tx(z.x)}" y="${ty(z.y)}"
      width="${z.w * scale}" height="${z.h * scale}"
      fill="transparent"
    />
  `;
    })
    .join('\n');
}

/**
 * Nearest wall and position (cm) from a room-space point.
 * maxDistance (cm) limits how far from a wall the pick is accepted; Infinity always picks.
 */
export function pickWallFromRoomPoint(
  roomX,
  roomY,
  roomWidth,
  roomLength,
  doorWidth = DEFAULT_DOOR_WIDTH,
  { maxDistance = Infinity, preferWall = null } = {}
) {
  const candidates = [];

  if (roomX >= 0 && roomX <= roomWidth) {
    candidates.push({ wall: 'top', dist: Math.abs(roomY), position: roomX });
    candidates.push({ wall: 'bottom', dist: Math.abs(roomY - roomLength), position: roomX });
  }
  if (roomY >= 0 && roomY <= roomLength) {
    candidates.push({ wall: 'left', dist: Math.abs(roomX), position: roomY });
    candidates.push({ wall: 'right', dist: Math.abs(roomX - roomWidth), position: roomY });
  }

  if (!candidates.length) return null;

  candidates.sort((a, b) => {
    if (a.dist !== b.dist) return a.dist - b.dist;
    if (preferWall) {
      if (a.wall === preferWall) return -1;
      if (b.wall === preferWall) return 1;
    }
    return 0;
  });

  const best = candidates[0];
  if (best.dist > maxDistance) return null;

  const position = clampPositionForWidth(
    best.wall,
    best.position,
    doorWidth,
    roomWidth,
    roomLength
  );

  return { wall: best.wall, position };
}

/**
 * Map a click in SVG user units to { wall, position } in cm, or null.
 */
export function pickWallFromPoint(
  svgX,
  svgY,
  roomWidth,
  roomLength,
  tx,
  ty,
  scale,
  threshold = 16,
  doorWidth = DEFAULT_DOOR_WIDTH
) {
  const roomX = (svgX - tx(0)) / scale;
  const roomY = (svgY - ty(0)) / scale;
  return pickWallFromRoomPoint(roomX, roomY, roomWidth, roomLength, doorWidth, {
    maxDistance: threshold / scale,
  });
}
