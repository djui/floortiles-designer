import { computeLayout, formatCm } from './layout.js';
import {
  createDoor,
  DEFAULT_DOOR_WIDTH,
  getDoorWidth,
  getWallLength,
  MAX_DOOR_WIDTH,
  MIN_DOOR_WIDTH,
  normalizeDoors,
  pickWallFromPoint,
  pickWallFromRoomPoint,
  positionAfterResize,
  renderDoorSvg,
  renderWallHitZones,
  widthFromHandleDrag,
  WALL_LABELS,
  WALLS,
} from './doors.js';
import {
  deleteProfile,
  EXPORT_VERSION,
  loadProfiles,
  loadSession,
  mergeImportedProfiles,
  parseProfileImport,
  processImageFile,
  profilesToExportJson,
  saveProfile,
  saveProfiles,
  saveSession,
} from './storage.js';

const form = document.getElementById('layout-form');
const svg = document.getElementById('layout-svg');
const statsEl = document.getElementById('stats');
const canvasWrap = document.getElementById('canvas-wrap');
const tileDropzone = document.getElementById('tile-dropzone');
const tileFileInput = document.getElementById('tile-file');
const tilePreview = document.getElementById('tile-preview');
const tilePreviewImg = document.getElementById('tile-preview-img');
const tilePreviewName = document.getElementById('tile-preview-name');
const tileClearBtn = document.getElementById('tile-clear');
const materialSelect = document.getElementById('material-select');
const storageNotice = document.getElementById('storage-notice');
const profileNameInput = document.getElementById('profile-name');
const saveProfileBtn = document.getElementById('save-profile');
const profileSelect = document.getElementById('profile-select');
const deleteProfileBtn = document.getElementById('delete-profile');
const exportProfileBtn = document.getElementById('export-profile');
const exportAllProfilesBtn = document.getElementById('export-all-profiles');
const importDropzone = document.getElementById('import-dropzone');
const importFileInput = document.getElementById('import-file');
const alternatingHint = document.getElementById('alternating-hint');
const addDoorBtn = document.getElementById('add-door');
const doorsListEl = document.getElementById('doors-list');
const exportImageBtn = document.getElementById('export-image');
const previewTitle = document.getElementById('preview-title');

const PADDING = 48;
const MIN_ZOOM = 0.5;
const PERSIST_DELAY = 300;
const EXPORT_IMAGE_SCALE = 2;
const EXPORT_LAYOUT_FALLBACK = 'julies-floor-layout';
const EXPORT_UNSAVED_FALLBACK = 'unsaved-layout';
const EXPORT_PROFILES_COLLECTION = 'julies-floor-profiles';
const CUSTOM_MATERIAL_ID = '';

function materialAssetUrl(filename) {
  return `${import.meta.env.BASE_URL}materials/${filename}`;
}

const MATERIAL_PRESETS = [
  {
    id: 'fluffy-panel',
    label: 'Fluffy (Panel)',
    panelWidth: 122,
    panelLength: 18,
    texture: {
      name: 'fluffy-panel.png',
      dataUrl: materialAssetUrl('fluffy-panel.png'),
    },
  },
  {
    id: 'floorify-tile',
    label: 'Floorify (Tile)',
    panelWidth: 30.5,
    panelLength: 61,
    texture: {
      name: 'floorify-tile.png',
      dataUrl: materialAssetUrl('floorify-tile.png'),
    },
  },
];

let tileImage = null;
let doors = [];
let selectedDoorId = null;
let dragState = null;
let persistTimer = null;
let noticeTimer = null;
let lastRenderContext = null;
let lastLayout = null;
let activeProfile = null;
let activeProfileSnapshot = null;
let selectedMaterialId = CUSTOM_MATERIAL_ID;

function setAccordionSection(button, expanded) {
  const panelId = button.getAttribute('aria-controls');
  const panel = panelId ? document.getElementById(panelId) : null;
  if (!panel) return;

  button.setAttribute('aria-expanded', String(expanded));
  panel.hidden = !expanded;
}

function openAccordionSection(section) {
  const button = section?.querySelector('.section-toggle');
  if (button) setAccordionSection(button, true);
}

function initSidebarAccordions() {
  document.querySelectorAll('[data-accordion-section] .section-toggle').forEach((button) => {
    setAccordionSection(button, button.getAttribute('aria-expanded') === 'true');

    button.addEventListener('click', () => {
      setAccordionSection(button, button.getAttribute('aria-expanded') !== 'true');
    });
  });

  document.querySelectorAll('.sidebar-nav a').forEach((link) => {
    link.addEventListener('click', () => {
      const section = document.querySelector(link.getAttribute('href'));
      openAccordionSection(section);
    });
  });

  if (window.location.hash) {
    openAccordionSection(document.querySelector(window.location.hash));
  }
}

function readInputs() {
  const orientation = Number(form.querySelector('input[name="orientation"]:checked').value);

  return {
    roomWidth: parseFloat(document.getElementById('room-width').value),
    roomLength: parseFloat(document.getElementById('room-length').value),
    panelWidth: parseFloat(document.getElementById('panel-width').value),
    panelLength: parseFloat(document.getElementById('panel-length').value),
    orientation,
    offsetWidth: parseFloat(document.getElementById('offset-width').value) || 0,
    offsetLength: parseFloat(document.getElementById('offset-length').value) || 0,
    alternating: document.getElementById('alternating').checked,
  };
}

function getMaterialPreset(id) {
  return MATERIAL_PRESETS.find((preset) => preset.id === id) ?? null;
}

function cloneTileImage(image) {
  if (!image?.dataUrl) return null;
  return {
    dataUrl: image.dataUrl,
    name: image.name || '',
  };
}

function populateMaterialSelect() {
  if (!materialSelect) return;

  for (const material of MATERIAL_PRESETS) {
    const option = document.createElement('option');
    option.value = material.id;
    option.textContent = material.label;
    materialSelect.appendChild(option);
  }
}

function syncMaterialSelect() {
  if (!materialSelect) return;
  materialSelect.value = getMaterialPreset(selectedMaterialId) ? selectedMaterialId : CUSTOM_MATERIAL_ID;
}

function markMaterialCustom() {
  if (!selectedMaterialId) return;
  selectedMaterialId = CUSTOM_MATERIAL_ID;
  syncMaterialSelect();
}

function isMaterialDimensionTarget(target) {
  return target?.id === 'panel-width' || target?.id === 'panel-length';
}

function getSessionState() {
  return {
    ...readInputs(),
    tileImage,
    doors,
    activeProfile,
    selectedMaterial: selectedMaterialId || null,
  };
}

function finiteNumber(value) {
  return Number.isFinite(value) ? value : null;
}

function normalizeTileImageSnapshot(image) {
  if (!image?.dataUrl) return null;
  return {
    dataUrl: image.dataUrl,
    name: image.name || '',
  };
}

function normalizeDoorSnapshot(door, roomWidth, roomLength) {
  return {
    id: door.id || '',
    wall: door.wall || 'top',
    position: finiteNumber(Number(door.position)),
    width: finiteNumber(Number(door.width)),
    facing: door.facing === 'outward' ? 'outward' : 'inward',
    hingeSide: door.hingeSide === 'end' ? 'end' : 'start',
  };
}

function createLayoutSnapshot(state) {
  const roomWidth = Number(state.roomWidth);
  const roomLength = Number(state.roomLength);
  const normalizedDoors =
    roomWidth > 0 && roomLength > 0
      ? normalizeDoors(state.doors, roomWidth, roomLength)
      : Array.isArray(state.doors)
        ? state.doors
        : [];

  return JSON.stringify({
    roomWidth: finiteNumber(roomWidth),
    roomLength: finiteNumber(roomLength),
    panelWidth: finiteNumber(Number(state.panelWidth)),
    panelLength: finiteNumber(Number(state.panelLength)),
    orientation: finiteNumber(Number(state.orientation)),
    offsetWidth: finiteNumber(Number(state.offsetWidth) || 0),
    offsetLength: finiteNumber(Number(state.offsetLength) || 0),
    alternating: Boolean(state.alternating),
    selectedMaterial: getMaterialPreset(state.selectedMaterial)?.id ?? null,
    tileImage: normalizeTileImageSnapshot(state.tileImage),
    doors: normalizedDoors.map((door) => normalizeDoorSnapshot(door, roomWidth, roomLength)),
  });
}

function setActiveProfile(profile, baselineState = profile) {
  activeProfile = { id: profile.id, name: profile.name };
  activeProfileSnapshot = createLayoutSnapshot(baselineState);
}

function clearActiveProfile() {
  activeProfile = null;
  activeProfileSnapshot = null;
}

function isActiveProfileModified() {
  return Boolean(activeProfile && activeProfileSnapshot !== createLayoutSnapshot(getSessionState()));
}

function updatePreviewTitle() {
  const baseTitle = activeProfile?.name || 'Unsaved layout';
  previewTitle.textContent =
    activeProfile && isActiveProfileModified() ? `${baseTitle} (modified)` : baseTitle;
}

function applySessionState(state) {
  if (!state) return;

  document.getElementById('room-width').value = state.roomWidth ?? 400;
  document.getElementById('room-length').value = state.roomLength ?? 300;
  document.getElementById('panel-width').value = state.panelWidth ?? 120;
  document.getElementById('panel-length').value = state.panelLength ?? 60;
  document.getElementById('offset-width').value = state.offsetWidth ?? 0;
  document.getElementById('offset-length').value = state.offsetLength ?? 0;
  document.getElementById('alternating').checked = Boolean(state.alternating);

  const orientation = String(state.orientation ?? 0);
  const orientationInput = form.querySelector(`input[name="orientation"][value="${orientation}"]`);
  if (orientationInput) orientationInput.checked = true;

  selectedMaterialId = getMaterialPreset(state.selectedMaterial)?.id ?? CUSTOM_MATERIAL_ID;
  syncMaterialSelect();

  const selectedMaterial = getMaterialPreset(selectedMaterialId);
  tileImage = state.tileImage?.dataUrl
    ? cloneTileImage(state.tileImage)
    : cloneTileImage(selectedMaterial?.texture);
  updateTilePreview();

  const roomWidth = parseFloat(document.getElementById('room-width').value) || 400;
  const roomLength = parseFloat(document.getElementById('room-length').value) || 300;
  doors = normalizeDoors(state.doors, roomWidth, roomLength);
}

function applyMaterialPreset(materialId) {
  const material = getMaterialPreset(materialId);
  if (!material) {
    selectedMaterialId = CUSTOM_MATERIAL_ID;
    syncMaterialSelect();
    update();
    schedulePersist();
    return;
  }

  selectedMaterialId = material.id;
  document.getElementById('panel-width').value = material.panelWidth;
  document.getElementById('panel-length').value = material.panelLength;
  tileImage = cloneTileImage(material.texture);
  tileFileInput.value = '';
  syncMaterialSelect();
  updateTilePreview();
  update();
  schedulePersist();
}

function validateInputs(inputs) {
  const errors = [];
  if (!(inputs.roomWidth > 0)) errors.push('Room width must be greater than 0.');
  if (!(inputs.roomLength > 0)) errors.push('Room length must be greater than 0.');
  if (!(inputs.panelWidth > 0)) errors.push('Panel width must be greater than 0.');
  if (!(inputs.panelLength > 0)) errors.push('Panel length must be greater than 0.');
  if (inputs.offsetWidth < 0) errors.push('Left cut cannot be negative.');
  if (inputs.offsetLength < 0) errors.push('Top cut cannot be negative.');
  return errors;
}

function showStorageNotice(message) {
  if (!message) {
    storageNotice.hidden = true;
    storageNotice.textContent = '';
    return;
  }

  storageNotice.textContent = message;
  storageNotice.hidden = false;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => showStorageNotice(''), 6000);
}

function schedulePersist() {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    const result = saveSession(getSessionState());
    if (result.warn) showStorageNotice(result.warn);
  }, PERSIST_DELAY);
}

function updateTilePreview() {
  if (tileImage) {
    tilePreviewImg.src = tileImage.dataUrl;
    tilePreviewImg.alt = tileImage.name || 'Tile texture preview';
    tilePreviewName.textContent = tileImage.name || 'Custom texture';
    tilePreview.hidden = false;
    tileDropzone.classList.add('tile-dropzone--has-image');
  } else {
    tilePreview.hidden = true;
    tilePreviewImg.removeAttribute('src');
    tilePreviewName.textContent = '';
    tileDropzone.classList.remove('tile-dropzone--has-image');
  }
}

async function setTileImageFromFile(file) {
  try {
    tileImage = await processImageFile(file);
    markMaterialCustom();
    updateTilePreview();
    update();
    schedulePersist();
  } catch (err) {
    showStorageNotice(err.message || 'Could not use that image.');
  }
}

function clearTileImage() {
  tileImage = null;
  tileFileInput.value = '';
  markMaterialCustom();
  updateTilePreview();
  update();
  schedulePersist();
}

function renormalizeDoors(roomWidth, roomLength) {
  doors = normalizeDoors(doors, roomWidth, roomLength);
}

function addDoor(overrides = {}) {
  const inputs = readInputs();
  const wall = overrides.wall ?? 'top';
  const wallLen = getWallLength(wall, inputs.roomWidth, inputs.roomLength);
  const door = createDoor({
    position: wallLen / 2,
    ...overrides,
  });
  doors.push(door);
  selectedDoorId = door.id;
  renormalizeDoors(inputs.roomWidth, inputs.roomLength);
  update();
}

function updateDoor(id, patch) {
  const door = doors.find((d) => d.id === id);
  if (!door) return;
  Object.assign(door, patch);
  const inputs = readInputs();
  renormalizeDoors(inputs.roomWidth, inputs.roomLength);
  update();
}

function removeDoor(id) {
  doors = doors.filter((d) => d.id !== id);
  if (selectedDoorId === id) selectedDoorId = null;
  update();
}

function selectDoor(id) {
  selectedDoorId = id;
  doorsListEl.querySelectorAll('.door-card').forEach((card) => {
    card.classList.toggle('door-card--selected', card.dataset.doorId === id);
  });
  renderPreview();
}

function svgPointFromEvent(event) {
  const pt = svg.createSVGPoint();
  pt.x = event.clientX;
  pt.y = event.clientY;
  return pt.matrixTransform(svg.getScreenCTM().inverse());
}

function roomPointFromSvg(svgX, svgY) {
  const { tx, ty, scale } = lastRenderContext;
  return {
    x: (svgX - tx(0)) / scale,
    y: (svgY - ty(0)) / scale,
  };
}

function syncDoorFormFields(id) {
  const door = doors.find((d) => d.id === id);
  if (!door || !lastLayout) return;

  const wallSelect = doorsListEl.querySelector(`.door-wall[data-door-id="${id}"]`);
  const posInput = doorsListEl.querySelector(`.door-position[data-door-id="${id}"]`);
  const widthInput = doorsListEl.querySelector(`.door-width[data-door-id="${id}"]`);
  const wallLen = getWallLength(door.wall, lastLayout.roomWidth, lastLayout.roomLength);
  const w = getDoorWidth(door);
  const maxPos = Math.max(w / 2, wallLen - w / 2);

  if (wallSelect && wallSelect.value !== door.wall) {
    wallSelect.value = door.wall;
  }
  if (posInput) {
    posInput.min = String(w / 2);
    posInput.max = String(maxPos);
    posInput.value = formatCm(door.position);
  }
  if (widthInput) {
    widthInput.value = formatCm(w);
  }
}

function renderDoorsList(roomWidth, roomLength) {
  if (!doors.length) {
    doorsListEl.innerHTML = '<p class="doors-empty">No doors placed yet.</p>';
    return;
  }

  doorsListEl.innerHTML = doors
    .map((door, index) => {
      const wallLen = getWallLength(door.wall, roomWidth, roomLength);
      const doorW = getDoorWidth(door);
      const maxPos = Math.max(doorW / 2, wallLen - doorW / 2);
      const selectedCls = door.id === selectedDoorId ? ' door-card--selected' : '';
      const wallOptions = WALLS.map(
        (w) =>
          `<option value="${w}"${door.wall === w ? ' selected' : ''}>${WALL_LABELS[w]}</option>`
      ).join('');

      return `
        <article class="door-card${selectedCls}" data-door-id="${door.id}">
          <div class="door-card__header">
            <span class="door-card__title">Door ${index + 1}</span>
            <button type="button" class="btn btn--ghost btn--sm door-remove" data-door-id="${door.id}">
              Delete
            </button>
          </div>
          <label class="field">
            <span class="field__label">Wall</span>
            <select class="door-wall" data-door-id="${door.id}">${wallOptions}</select>
          </label>
          <label class="field">
            <span class="field__label">Position along wall <small>(cm)</small></span>
            <input
              type="number"
              class="door-position"
              data-door-id="${door.id}"
              min="${doorW / 2}"
              max="${maxPos}"
              step="1"
              value="${formatCm(door.position)}"
            />
          </label>
          <label class="field">
            <span class="field__label">Width <small>(cm)</small></span>
            <input
              type="number"
              class="door-width"
              data-door-id="${door.id}"
              min="${MIN_DOOR_WIDTH}"
              max="${MAX_DOOR_WIDTH}"
              step="1"
              value="${formatCm(doorW)}"
            />
          </label>
          <div class="door-control-group">
            <span class="field__label">Facing</span>
            <div class="door-facing" role="radiogroup" aria-label="Door ${index + 1} facing">
              <label class="facing-option">
                <input
                  type="radio"
                  class="door-facing-input"
                  name="facing-${door.id}"
                  value="inward"
                  data-door-id="${door.id}"
                  ${door.facing === 'inward' ? 'checked' : ''}
                />
                <span class="facing-option__box">Inward</span>
              </label>
              <label class="facing-option">
                <input
                  type="radio"
                  class="door-facing-input"
                  name="facing-${door.id}"
                  value="outward"
                  data-door-id="${door.id}"
                  ${door.facing === 'outward' ? 'checked' : ''}
                />
                <span class="facing-option__box">Outward</span>
              </label>
            </div>
          </div>
          <div class="door-control-group">
            <span class="field__label">Opening orientation</span>
            <div class="door-hinge" role="radiogroup" aria-label="Door ${index + 1} opening orientation">
              <label class="hinge-option">
                <input
                  type="radio"
                  class="door-hinge-input"
                  name="hinge-${door.id}"
                  value="start"
                  data-door-id="${door.id}"
                  ${door.hingeSide === 'start' ? 'checked' : ''}
                />
                <span class="hinge-option__box">Left/top hinge</span>
              </label>
              <label class="hinge-option">
                <input
                  type="radio"
                  class="door-hinge-input"
                  name="hinge-${door.id}"
                  value="end"
                  data-door-id="${door.id}"
                  ${door.hingeSide === 'end' ? 'checked' : ''}
                />
                <span class="hinge-option__box">Right/bottom hinge</span>
              </label>
            </div>
          </div>
        </article>
      `;
    })
    .join('');
}

function updateAlternatingHint(orientation) {
  if (!alternatingHint) return;

  if (orientation === 90) {
    alternatingHint.textContent =
      'Even columns start from the top; odd columns from the bottom, creating a top-bottom-top-bottom staggered pattern along the oriented row direction.';
  } else {
    alternatingHint.textContent =
      'Even rows start from the left; odd rows from the right, creating a left-right-left-right staggered pattern along the oriented row direction.';
  }
}

function renderStats(layout) {
  const { stats, tileW, tileL } = layout;

  const edgeRow = (label, cut) =>
    cut
      ? `<tr><td>${label}</td><td>${formatCm(cut.size)} cm</td></tr>`
      : `<tr><td>${label}</td><td class="muted">—</td></tr>`;

  statsEl.innerHTML = `
    <h3>Statistics</h3>
    <dl class="stats-grid">
      <div><dt>Full panels</dt><dd>${stats.fullCount}</dd></div>
      <div><dt>Cut panels</dt><dd>${stats.cutCount}</dd></div>
      <div><dt>Total pieces</dt><dd>${stats.totalPanels}</dd></div>
      <div><dt>Grid</dt><dd>${stats.columns} × ${stats.rows}</dd></div>
      ${
        layout.alternating
          ? `<div><dt>Row direction</dt><dd>${layout.orientation === 90 ? 'Alternating T/B' : 'Alternating L/R'}</dd></div>`
          : ''
      }
      <div><dt>Effective tile</dt><dd>${formatCm(tileW)} × ${formatCm(tileL)} cm</dd></div>
      <div><dt>Material needed</dt><dd>≈ ${stats.materialPanels} panels</dd></div>
      <div><dt>Coverage</dt><dd>${stats.coveragePercent.toFixed(1)}%</dd></div>
      <div><dt>Room area</dt><dd>${formatCm(stats.roomArea / 100)} m²</dd></div>
    </dl>
    <h3>Edge cuts</h3>
    <table class="edge-table">
      <tbody>
        ${edgeRow('Left', stats.leftCut)}
        ${edgeRow('Right', stats.rightCut)}
        ${edgeRow('Top', stats.topCut)}
        ${edgeRow('Bottom', stats.bottomCut)}
      </tbody>
    </table>
  `;
}

function renderError(messages) {
  updatePreviewTitle();
  statsEl.innerHTML = `<div class="error">${messages.join(' ')}</div>`;
  const roomWidth = parseFloat(document.getElementById('room-width').value);
  const roomLength = parseFloat(document.getElementById('room-length').value);
  if (roomWidth > 0 && roomLength > 0) {
    renderDoorsList(roomWidth, roomLength);
  } else {
    doorsListEl.innerHTML = '<p class="doors-empty">No doors placed yet.</p>';
  }
  svg.innerHTML = '';
  svg.removeAttribute('viewBox');
  lastRenderContext = null;
}

function buildPatternDef(layout, scale) {
  if (!tileImage) return '';

  const patternW = layout.tileW * scale;
  const patternH = layout.tileL * scale;

  return `
    <defs>
      <pattern
        id="tile-pattern"
        patternUnits="userSpaceOnUse"
        width="${patternW}"
        height="${patternH}"
      >
        <image
          href="${tileImage.dataUrl}"
          width="${patternW}"
          height="${patternH}"
          preserveAspectRatio="xMidYMid slice"
        />
      </pattern>
    </defs>
  `;
}

function outwardDoorSwingMargin() {
  return doors.reduce(
    (max, d) => (d.facing === 'outward' ? Math.max(max, getDoorWidth(d)) : max),
    0
  );
}

function renderSvg(layout) {
  const { roomWidth, roomLength, panels } = layout;
  const wrapRect = canvasWrap.getBoundingClientRect();
  const availW = Math.max(wrapRect.width - 2, 200);
  const availH = Math.max(wrapRect.height - 2, 200);
  const margin = PADDING + outwardDoorSwingMargin();

  const scale = Math.max(
    MIN_ZOOM,
    Math.min((availW - margin * 2) / roomWidth, (availH - margin * 2) / roomLength)
  );

  const svgW = roomWidth * scale + margin * 2;
  const svgH = roomLength * scale + margin * 2;

  svg.setAttribute('viewBox', `0 0 ${svgW} ${svgH}`);
  svg.setAttribute('width', svgW);
  svg.setAttribute('height', svgH);

  const tx = (x) => margin + x * scale;
  const ty = (y) => margin + y * scale;
  const hasTexture = Boolean(tileImage);
  const parts = [buildPatternDef(layout, scale)];

  parts.push(`
    <rect
      x="${tx(0)}" y="${ty(0)}"
      width="${roomWidth * scale}" height="${roomLength * scale}"
      class="room-outline"
      rx="2"
    />
  `);

  parts.push(`
    <text x="${tx(roomWidth / 2)}" y="${margin / 2 + 4}" class="dim-label" text-anchor="middle">
      ${formatCm(roomWidth)} cm
    </text>
    <text
      x="${margin / 2 - 4}" y="${ty(roomLength / 2)}"
      class="dim-label" text-anchor="middle"
      transform="rotate(-90, ${margin / 2 - 4}, ${ty(roomLength / 2)})"
    >
      ${formatCm(roomLength)} cm
    </text>
  `);

  for (const panel of panels) {
    const px = tx(panel.x);
    const py = ty(panel.y);
    const pw = panel.width * scale;
    const ph = panel.height * scale;
    const textureCls = hasTexture ? ' panel--textured' : '';
    const cls = panel.isFull
      ? `panel panel--full${textureCls}`
      : `panel panel--cut${textureCls}`;
    const fillAttr = hasTexture ? ' fill="url(#tile-pattern)"' : '';

    parts.push(`
      <rect x="${px}" y="${py}" width="${pw}" height="${ph}" class="${cls}"${fillAttr} rx="1" />
    `);

    if (hasTexture && !panel.isFull) {
      parts.push(`
        <rect
          x="${px}" y="${py}" width="${pw}" height="${ph}"
          class="panel-cut-overlay" rx="1"
        />
      `);
    }

    if (pw > 28 && ph > 18) {
      const label = panel.isFull
        ? 'Full'
        : `${formatCm(panel.width)}×${formatCm(panel.height)}`;
      parts.push(`
        <text x="${px + pw / 2}" y="${py + ph / 2 + 4}" class="panel-label" text-anchor="middle">
          ${label}
        </text>
      `);
    }
  }

  const highlightWall = dragState?.mode === 'move' ? dragState.snapWall : null;
  parts.push(renderWallHitZones(roomWidth, roomLength, tx, ty, scale, 14, highlightWall));

  for (const door of doors) {
    parts.push(
      renderDoorSvg(door, roomWidth, roomLength, tx, ty, scale, {
        selected: door.id === selectedDoorId,
      })
    );
  }

  lastRenderContext = { roomWidth, roomLength, scale, tx, ty, svgW, svgH };

  svg.innerHTML = parts.join('\n');
}

function renderPreview() {
  if (!lastLayout) return;
  updatePreviewTitle();
  renderSvg(lastLayout);
}

function update() {
  const inputs = readInputs();
  updateAlternatingHint(inputs.orientation);
  const errors = validateInputs(inputs);
  if (errors.length) {
    renderError(errors);
    schedulePersist();
    return;
  }

  const layout = computeLayout(inputs);
  lastLayout = layout;
  renormalizeDoors(layout.roomWidth, layout.roomLength);
  if (selectedDoorId && !doors.some((d) => d.id === selectedDoorId)) {
    selectedDoorId = null;
  }
  renderDoorsList(layout.roomWidth, layout.roomLength);
  renderStats(layout);
  updatePreviewTitle();
  renderSvg(layout);
  schedulePersist();
}

function refreshProfileSelect(selectedId = '') {
  const profiles = loadProfiles().sort((a, b) => a.name.localeCompare(b.name));
  profileSelect.innerHTML = '<option value="">— Choose a profile —</option>';
  for (const profile of profiles) {
    const option = document.createElement('option');
    option.value = profile.id;
    option.textContent = profile.name;
    profileSelect.appendChild(option);
  }
  profileSelect.value = selectedId;
  const hasSelectedProfile = Boolean(profileSelect.value);
  deleteProfileBtn.disabled = !hasSelectedProfile;
  exportProfileBtn.disabled = !hasSelectedProfile;
  exportAllProfilesBtn.disabled = profiles.length === 0;
}

function restoreActiveProfileFromSession(session) {
  const profileId = session?.activeProfile?.id;
  if (!profileId) {
    clearActiveProfile();
    return;
  }

  const profile = loadProfiles().find((p) => p.id === profileId);
  if (profile) {
    setActiveProfile(profile);
  } else {
    clearActiveProfile();
  }
}

function exportTimestamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
  ].join('-') + `-${pad(date.getHours())}${pad(date.getMinutes())}`;
}

function sanitizeExportFilename(name, fallback = EXPORT_LAYOUT_FALLBACK) {
  const safe = String(name ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
  return safe || fallback;
}

function buildExportFilename(name, extension, fallback) {
  const base = sanitizeExportFilename(name, fallback);
  return `${base}-${exportTimestamp()}-v${EXPORT_VERSION}.${extension}`;
}

function getSelectedProfileName() {
  if (!profileSelect.value) return '';
  return profileSelect.selectedOptions[0]?.textContent || '';
}

function downloadJsonFile(filename, json) {
  const blob = new Blob([json], { type: 'application/json' });
  downloadBlob(filename, blob);
}

function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function imageFromUrl(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not render the layout image.'));
    img.src = url;
  });
}

function canvasToPngBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Could not create the PNG file.'));
    }, 'image/png');
  });
}

function buildExportSvgStyles() {
  const vars = getComputedStyle(document.documentElement);
  const value = (name) => vars.getPropertyValue(name).trim();

  return `
    svg {
      background: #fff;
      font-family: 'DM Sans', system-ui, sans-serif;
    }
    .room-outline {
      fill: none;
      stroke: ${value('--text')};
      stroke-width: 2;
    }
    .panel {
      stroke-width: 1.5;
    }
    .panel--full:not(.panel--textured) {
      fill: ${value('--full')};
      stroke: ${value('--full-border')};
    }
    .panel--full.panel--textured {
      stroke: ${value('--full-border')};
    }
    .panel--cut:not(.panel--textured) {
      fill: ${value('--cut')};
      stroke: ${value('--cut-border')};
      stroke-dasharray: 4 2;
    }
    .panel--cut.panel--textured {
      stroke: ${value('--cut-border')};
      stroke-dasharray: 4 2;
    }
    .panel-cut-overlay {
      fill: rgb(253 230 138 / 0.42);
      stroke: none;
    }
    .panel-label {
      font-size: 10px;
      fill: ${value('--text')};
      opacity: 0.75;
    }
    .dim-label {
      font-size: 11px;
      fill: ${value('--text-muted')};
      font-weight: 500;
    }
    .door-opening,
    .door-leaf,
    .door-arc {
      fill: none;
      stroke: #7c3aed;
      stroke-width: 2;
      vector-effect: non-scaling-stroke;
      stroke-linecap: round;
    }
    .door-opening {
      stroke-width: 2.5;
    }
    .door-wall-hit,
    .door-hit,
    .door-resize-handle {
      display: none;
    }
  `;
}

function serializeSvgForExport() {
  const clone = svg.cloneNode(true);
  const width = Number(svg.getAttribute('width')) || lastRenderContext.svgW;
  const height = Number(svg.getAttribute('height')) || lastRenderContext.svgH;

  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('width', width);
  clone.setAttribute('height', height);
  clone.classList.remove('layout-svg--dragging');
  clone.querySelectorAll('.door-symbol--selected').forEach((doorEl) => {
    doorEl.classList.remove('door-symbol--selected');
  });

  const style = document.createElementNS('http://www.w3.org/2000/svg', 'style');
  style.textContent = buildExportSvgStyles();
  clone.insertBefore(style, clone.firstChild);

  return {
    svgText: new XMLSerializer().serializeToString(clone),
    width,
    height,
  };
}

async function handleExportImage() {
  if (!lastLayout || !lastRenderContext) {
    showStorageNotice('Create a valid layout before exporting an image.');
    return;
  }

  try {
    const { svgText, width, height } = serializeSvgForExport();
    const svgBlob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' });
    const svgUrl = URL.createObjectURL(svgBlob);

    try {
      const img = await imageFromUrl(svgUrl);
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(width * EXPORT_IMAGE_SCALE);
      canvas.height = Math.ceil(height * EXPORT_IMAGE_SCALE);

      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

      const filename = buildExportFilename(
        getSelectedProfileName(),
        'png',
        EXPORT_UNSAVED_FALLBACK
      );
      const pngBlob = await canvasToPngBlob(canvas);
      downloadBlob(filename, pngBlob);
      showStorageNotice(`Exported ${filename}.`);
    } finally {
      URL.revokeObjectURL(svgUrl);
    }
  } catch (err) {
    showStorageNotice(err.message || 'Could not export the layout image.');
  }
}

function handleExportProfile() {
  const id = profileSelect.value;
  if (!id) {
    showStorageNotice('Choose a profile to export.');
    return;
  }

  const profile = loadProfiles().find((p) => p.id === id);
  if (!profile) {
    showStorageNotice('That profile could not be found.');
    clearActiveProfile();
    refreshProfileSelect();
    updatePreviewTitle();
    return;
  }

  const filename = buildExportFilename(profile.name, 'json', EXPORT_UNSAVED_FALLBACK);
  const json = profilesToExportJson([profile]);
  downloadJsonFile(filename, json);
  showStorageNotice(`Profile "${profile.name}" exported.`);
}

function handleExportAllProfiles() {
  const profiles = loadProfiles();
  if (!profiles.length) {
    showStorageNotice('No saved profiles to export.');
    return;
  }

  const filename = buildExportFilename(EXPORT_PROFILES_COLLECTION, 'json', EXPORT_PROFILES_COLLECTION);
  const json = profilesToExportJson(profiles);
  downloadJsonFile(filename, json);
  showStorageNotice(`Exported ${profiles.length} profile${profiles.length === 1 ? '' : 's'}.`);
}

async function handleImportProfiles(file) {
  if (!file) return;

  let parsed;
  try {
    parsed = parseProfileImport(await file.text());
  } catch (err) {
    showStorageNotice(err.message || 'Could not import that file.');
    return;
  }

  const existing = loadProfiles();
  const hasNameConflicts = parsed.profiles.some((profile) =>
    existing.some((entry) => entry.name.toLowerCase() === profile.name.toLowerCase())
  );

  let nameConflict = 'suffix';
  if (hasNameConflicts) {
    const importAsCopies = window.confirm(
      'Some imported profile names already exist.\n\nOK = import as new copies (names get a number suffix)\nCancel = replace existing profiles with the imported versions'
    );
    nameConflict = importAsCopies ? 'suffix' : 'replace';
  }

  const { profiles, importedIds, warnings } = mergeImportedProfiles(
    existing,
    parsed.profiles,
    { nameConflict }
  );

  const result = saveProfiles(profiles);
  if (!result.ok) {
    showStorageNotice(result.warn || 'Could not import profiles.');
    return;
  }

  const firstImportedId = importedIds[0] ?? '';
  refreshProfileSelect(firstImportedId);

  if (firstImportedId) {
    const profile = profiles.find((p) => p.id === firstImportedId);
    if (profile) {
      applySessionState(profile);
      setActiveProfile(profile);
      update();
      saveSession(getSessionState());
    }
  }

  const count = importedIds.length;
  const summary = count
    ? `Imported ${count} profile${count === 1 ? '' : 's'}.`
    : 'No profiles were imported.';
  const detail = [...parsed.warnings, ...warnings, result.warn].filter(Boolean).join(' ');
  showStorageNotice(detail ? `${summary} ${detail}` : summary);
}

function handleSaveProfile() {
  const name = profileNameInput.value.trim();
  if (!name) {
    showStorageNotice('Enter a profile name before saving.');
    profileNameInput.focus();
    return;
  }

  const inputs = readInputs();
  const errors = validateInputs(inputs);
  if (errors.length) {
    showStorageNotice(errors.join(' '));
    return;
  }

  const existing = loadProfiles().find((p) => p.name.toLowerCase() === name.toLowerCase());
  const profile = {
    id: existing?.id ?? crypto.randomUUID(),
    name,
    createdAt: existing?.createdAt ?? Date.now(),
    ...inputs,
    tileImage,
    doors,
    selectedMaterial: selectedMaterialId || null,
  };

  const result = saveProfile(profile);
  if (!result.ok) {
    showStorageNotice(result.warn || 'Could not save profile.');
    return;
  }

  if (result.warn) showStorageNotice(result.warn);
  setActiveProfile(profile);
  refreshProfileSelect(profile.id);
  profileNameInput.value = '';
  saveSession(getSessionState());
  updatePreviewTitle();
  showStorageNotice(`Profile "${name}" saved.`);
}

function handleLoadProfile() {
  const id = profileSelect.value;
  if (!id) {
    clearActiveProfile();
    updatePreviewTitle();
    schedulePersist();
    return;
  }

  const profile = loadProfiles().find((p) => p.id === id);
  if (!profile) {
    showStorageNotice('That profile could not be found.');
    refreshProfileSelect();
    return;
  }

  applySessionState(profile);
  setActiveProfile(profile);
  update();
  saveSession(getSessionState());
}

function handleDeleteProfile() {
  const id = profileSelect.value;
  if (!id) return;

  const profile = loadProfiles().find((p) => p.id === id);
  if (!profile) {
    refreshProfileSelect();
    return;
  }

  if (!window.confirm(`Delete profile "${profile.name}"?`)) return;

  const result = deleteProfile(id);
  if (!result.ok) {
    showStorageNotice(result.warn || 'Could not delete profile.');
    return;
  }

  if (activeProfile?.id === id) {
    clearActiveProfile();
    updatePreviewTitle();
    saveSession(getSessionState());
  }
  refreshProfileSelect();
  showStorageNotice(`Profile "${profile.name}" deleted.`);
}

tileDropzone.addEventListener('click', () => tileFileInput.click());
tileDropzone.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    tileFileInput.click();
  }
});

tileDropzone.addEventListener('dragover', (event) => {
  event.preventDefault();
  tileDropzone.classList.add('tile-dropzone--active');
});

tileDropzone.addEventListener('dragleave', () => {
  tileDropzone.classList.remove('tile-dropzone--active');
});

tileDropzone.addEventListener('drop', (event) => {
  event.preventDefault();
  tileDropzone.classList.remove('tile-dropzone--active');
  const file = event.dataTransfer?.files?.[0];
  if (file) setTileImageFromFile(file);
});

tileFileInput.addEventListener('change', () => {
  const file = tileFileInput.files?.[0];
  if (file) setTileImageFromFile(file);
});

tileClearBtn.addEventListener('click', clearTileImage);
materialSelect.addEventListener('change', () => applyMaterialPreset(materialSelect.value));

saveProfileBtn.addEventListener('click', handleSaveProfile);
exportProfileBtn.addEventListener('click', handleExportProfile);
exportAllProfilesBtn.addEventListener('click', handleExportAllProfiles);
exportImageBtn.addEventListener('click', handleExportImage);
profileSelect.addEventListener('change', () => {
  deleteProfileBtn.disabled = !profileSelect.value;
  exportProfileBtn.disabled = !profileSelect.value;
  handleLoadProfile();
});
deleteProfileBtn.addEventListener('click', handleDeleteProfile);

importDropzone.addEventListener('click', () => importFileInput.click());
importDropzone.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    importFileInput.click();
  }
});

importDropzone.addEventListener('dragover', (event) => {
  event.preventDefault();
  importDropzone.classList.add('import-dropzone--active');
});

importDropzone.addEventListener('dragleave', () => {
  importDropzone.classList.remove('import-dropzone--active');
});

importDropzone.addEventListener('drop', (event) => {
  event.preventDefault();
  importDropzone.classList.remove('import-dropzone--active');
  const file = event.dataTransfer?.files?.[0];
  if (file) handleImportProfiles(file);
});

importFileInput.addEventListener('change', () => {
  const file = importFileInput.files?.[0];
  if (file) handleImportProfiles(file);
  importFileInput.value = '';
});

addDoorBtn.addEventListener('click', () => addDoor());

doorsListEl.addEventListener('change', (event) => {
  const id = event.target.dataset.doorId;
  if (!id) return;

  if (event.target.classList.contains('door-wall')) {
    const inputs = readInputs();
    const wallLen = getWallLength(event.target.value, inputs.roomWidth, inputs.roomLength);
    updateDoor(id, { wall: event.target.value, position: wallLen / 2 });
  } else if (event.target.classList.contains('door-facing-input')) {
    updateDoor(id, { facing: event.target.value });
  } else if (event.target.classList.contains('door-hinge-input')) {
    updateDoor(id, { hingeSide: event.target.value });
  }
});

doorsListEl.addEventListener('input', (event) => {
  const id = event.target.dataset.doorId;
  if (!id) return;

  if (event.target.classList.contains('door-position')) {
    updateDoor(id, { position: parseFloat(event.target.value) || 0 });
  } else if (event.target.classList.contains('door-width')) {
    updateDoor(id, { width: parseFloat(event.target.value) || DEFAULT_DOOR_WIDTH });
  }
});

doorsListEl.addEventListener('click', (event) => {
  const facingOption = event.target.closest('.facing-option');
  if (facingOption) {
    const input = facingOption.querySelector('.door-facing-input');
    if (input?.dataset.doorId) {
      updateDoor(input.dataset.doorId, { facing: input.value });
    }
    return;
  }

  const hingeOption = event.target.closest('.hinge-option');
  if (hingeOption) {
    const input = hingeOption.querySelector('.door-hinge-input');
    if (input?.dataset.doorId) {
      updateDoor(input.dataset.doorId, { hingeSide: input.value });
    }
    return;
  }

  const btn = event.target.closest('.door-remove');
  if (btn) {
    removeDoor(btn.dataset.doorId);
    return;
  }

  const card = event.target.closest('.door-card');
  if (card?.dataset.doorId && !event.target.closest('input, select, button, label')) {
    selectDoor(card.dataset.doorId);
  }
});

function finishDrag() {
  if (!dragState) return;
  const { doorId } = dragState;
  dragState = null;
  svg.classList.remove('layout-svg--dragging');
  syncDoorFormFields(doorId);
  schedulePersist();
}

function handlePointerMove(event) {
  if (!dragState || !lastRenderContext) return;

  const door = doors.find((d) => d.id === dragState.doorId);
  if (!door) return;

  const svgPt = svgPointFromEvent(event);
  const room = roomPointFromSvg(svgPt.x, svgPt.y);
  const { roomWidth, roomLength } = lastRenderContext;

  if (dragState.mode === 'move') {
    const pick = pickWallFromRoomPoint(
      room.x,
      room.y,
      roomWidth,
      roomLength,
      getDoorWidth(door),
      { preferWall: door.wall }
    );
    if (pick) {
      door.wall = pick.wall;
      door.position = pick.position;
      dragState.snapWall = pick.wall;
      renormalizeDoors(roomWidth, roomLength);
      syncDoorFormFields(door.id);
      renderPreview();
    }
  } else if (dragState.mode === 'resize') {
    const newWidth = widthFromHandleDrag(door, room.x, room.y, roomWidth, roomLength);
    const newPos = positionAfterResize(door, newWidth, roomWidth, roomLength);
    door.width = newWidth;
    door.position = newPos;
    renormalizeDoors(roomWidth, roomLength);
    renderPreview();
  }
}

svg.addEventListener('pointerdown', (event) => {
  if (!lastRenderContext) return;

  const handle = event.target.closest('[data-action]');
  if (handle) {
    event.preventDefault();
    const doorId = handle.dataset.doorId;
    const door = doors.find((d) => d.id === doorId);
    selectedDoorId = doorId;
    dragState = { mode: handle.dataset.action, doorId, snapWall: door?.wall ?? null };
    svg.classList.add('layout-svg--dragging');
    svg.setPointerCapture(event.pointerId);
    renderPreview();
    return;
  }

  const doorEl = event.target.closest('.door-symbol');
  if (doorEl) {
    event.preventDefault();
    selectedDoorId = doorEl.dataset.doorId;
    const door = doors.find((d) => d.id === selectedDoorId);
    dragState = { mode: 'move', doorId: selectedDoorId, snapWall: door?.wall ?? null };
    svg.classList.add('layout-svg--dragging');
    svg.setPointerCapture(event.pointerId);
    renderPreview();
    return;
  }

  if (event.target.closest('.door-wall-hit')) return;

  selectedDoorId = null;
  renderPreview();
});

svg.addEventListener('pointermove', handlePointerMove);

svg.addEventListener('pointerup', (event) => {
  if (dragState && svg.hasPointerCapture(event.pointerId)) {
    svg.releasePointerCapture(event.pointerId);
  }
  finishDrag();
});

svg.addEventListener('pointercancel', finishDrag);

svg.addEventListener('click', (event) => {
  if (!lastRenderContext || dragState) return;
  if (event.target.closest('[data-door-id]')) return;

  const pt = svgPointFromEvent(event);
  const { roomWidth, roomLength, tx, ty, scale } = lastRenderContext;
  const pick = pickWallFromPoint(
    pt.x,
    pt.y,
    roomWidth,
    roomLength,
    tx,
    ty,
    scale,
    16,
    DEFAULT_DOOR_WIDTH
  );
  if (pick) {
    addDoor({ wall: pick.wall, position: pick.position });
  }
});

form.addEventListener('input', (event) => {
  if (isMaterialDimensionTarget(event.target)) markMaterialCustom();
  update();
});
form.addEventListener('change', (event) => {
  if (event.target === materialSelect) return;
  if (isMaterialDimensionTarget(event.target)) markMaterialCustom();
  update();
});
window.addEventListener('resize', update);

initSidebarAccordions();
populateMaterialSelect();
const restoredSession = loadSession();
applySessionState(restoredSession);
restoreActiveProfileFromSession(restoredSession);
refreshProfileSelect(activeProfile?.id ?? '');
update();
