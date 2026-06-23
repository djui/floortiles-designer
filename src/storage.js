export const STORAGE_KEYS = {
  session: 'julies-floor-designer:session',
  profiles: 'julies-floor-designer:profiles',
};

export const EXPORT_FORMAT = 'julies-floor-designer-profiles';
export const EXPORT_VERSION = 1;

const MAX_IMAGE_DIM = 800;
const JPEG_QUALITY = 0.85;

export function loadSession() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.session);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function saveSession(state, { includeImage = true } = {}) {
  const payload = serializeSessionState(state, includeImage);
  return writeJson(STORAGE_KEYS.session, payload, () => {
    if (includeImage && state.tileImage) {
      return writeJson(STORAGE_KEYS.session, serializeSessionState(state, false), {
        warn: 'Settings saved, but the tile image was too large for storage and was not persisted.',
      });
    }
    return { ok: false, warn: 'Could not save settings — browser storage may be full.' };
  });
}

export function loadProfiles() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.profiles);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveProfile(profile, { includeImage = true } = {}) {
  const profiles = loadProfiles();
  const existing = profiles.findIndex((p) => p.id === profile.id);
  const entry = serializeProfile(profile, includeImage);

  if (existing >= 0) profiles[existing] = entry;
  else profiles.push(entry);

  const result = writeJson(STORAGE_KEYS.profiles, profiles, () => {
    if (includeImage && profile.tileImage) {
      const withoutImage = { ...profile, tileImage: null };
      const retryProfiles = [...profiles];
      if (existing >= 0) retryProfiles[existing] = serializeProfile(withoutImage, false);
      else retryProfiles[retryProfiles.length - 1] = serializeProfile(withoutImage, false);
      return writeJson(STORAGE_KEYS.profiles, retryProfiles, {
        warn: `Profile "${profile.name}" saved without the tile image (storage limit).`,
      });
    }
    return { ok: false, warn: 'Could not save profile — browser storage may be full.' };
  });

  return result;
}

export function deleteProfile(id) {
  const profiles = loadProfiles().filter((p) => p.id !== id);
  return writeJson(STORAGE_KEYS.profiles, profiles, {
    warn: 'Could not delete profile — browser storage may be full.',
  });
}

export function saveProfiles(profiles, { includeImage = true } = {}) {
  const payload = profiles.map((profile) => serializeProfile(profile, includeImage));
  return writeJson(STORAGE_KEYS.profiles, payload, () => {
    if (includeImage && profiles.some((p) => p.tileImage)) {
      const withoutImages = profiles.map((profile) =>
        profile.tileImage ? { ...profile, tileImage: null } : profile
      );
      return writeJson(
        STORAGE_KEYS.profiles,
        withoutImages.map((profile) => serializeProfile(profile, false)),
        {
          warn: 'Profiles imported, but tile images were too large for storage and were omitted.',
        }
      );
    }
    return { ok: false, warn: 'Could not save profiles — browser storage may be full.' };
  });
}

export function buildExportDocument(profiles) {
  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    app: "Julie's Floor Designer",
    profiles: profiles.map((profile) => serializeProfile(profile, true)),
  };
}

export function profilesToExportJson(profiles) {
  return JSON.stringify(buildExportDocument(profiles), null, 2);
}

export function parseProfileImport(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('Invalid JSON — could not parse the file.');
  }

  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('Invalid profile file — expected a JSON object.');
  }

  let profilesRaw;
  if (data.format === EXPORT_FORMAT || Array.isArray(data.profiles)) {
    if (!Array.isArray(data.profiles)) {
      throw new Error('Invalid profile file — missing profiles array.');
    }
    profilesRaw = data.profiles;
  } else if (typeof data.name === 'string' && data.roomWidth !== undefined) {
    profilesRaw = [data];
  } else {
    throw new Error('Unrecognized profile file format.');
  }

  if (!profilesRaw.length) {
    throw new Error('No profiles found in the file.');
  }

  const warnings = [];
  if (typeof data.version === 'number' && data.version > EXPORT_VERSION) {
    warnings.push('This file was exported from a newer app version.');
  }

  const profiles = profilesRaw.map((raw, index) => {
    const profile = validateImportedProfile(raw, index);
    if (profile.tileImage?.dataUrl?.length > 500_000) {
      warnings.push(
        `Profile "${profile.name}" includes a large tile image; saving may omit it if storage is full.`
      );
    }
    return profile;
  });

  return { profiles, warnings };
}

/**
 * @param {'suffix' | 'replace' | 'skip'} nameConflict
 */
export function mergeImportedProfiles(existing, imported, { nameConflict = 'suffix' } = {}) {
  const result = [...existing];
  const usedIds = new Set(existing.map((p) => p.id));
  const usedNames = new Set(existing.map((p) => p.name.toLowerCase()));
  const importedIds = [];
  const warnings = [];

  for (const raw of imported) {
    const profile = { ...raw };

    if (usedIds.has(profile.id)) {
      profile.id = crypto.randomUUID();
    }
    usedIds.add(profile.id);

    const nameKey = profile.name.toLowerCase();
    if (usedNames.has(nameKey)) {
      if (nameConflict === 'replace') {
        const index = result.findIndex((p) => p.name.toLowerCase() === nameKey);
        if (index >= 0) result[index] = profile;
        else result.push(profile);
        usedNames.add(nameKey);
        importedIds.push(profile.id);
        continue;
      }
      if (nameConflict === 'skip') {
        warnings.push(`Skipped "${profile.name}" (name already exists).`);
        continue;
      }

      const originalName = profile.name;
      profile.name = uniquifyProfileName(profile.name, usedNames);
      warnings.push(`Imported "${originalName}" as "${profile.name}" (name already exists).`);
    }

    usedNames.add(profile.name.toLowerCase());
    result.push(profile);
    importedIds.push(profile.id);
  }

  return { profiles: result, importedIds, warnings };
}

export function processImageFile(file) {
  if (!file || !file.type.startsWith('image/')) {
    return Promise.reject(new Error('Please choose an image file.'));
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > MAX_IMAGE_DIM || height > MAX_IMAGE_DIM) {
          const ratio = Math.min(MAX_IMAGE_DIM / width, MAX_IMAGE_DIM / height);
          width = Math.round(width * ratio);
          height = Math.round(height * ratio);
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        resolve({
          dataUrl: canvas.toDataURL('image/jpeg', JPEG_QUALITY),
          name: file.name,
        });
      };
      img.onerror = () => reject(new Error('Could not load that image.'));
      img.src = reader.result;
    };
    reader.onerror = () => reject(new Error('Could not read that file.'));
    reader.readAsDataURL(file);
  });
}

function serializeState(state, includeImage) {
  return {
    roomWidth: state.roomWidth,
    roomLength: state.roomLength,
    panelWidth: state.panelWidth,
    panelLength: state.panelLength,
    orientation: state.orientation,
    offsetWidth: state.offsetWidth,
    offsetLength: state.offsetLength,
    alternating: state.alternating,
    doors: Array.isArray(state.doors) ? state.doors : [],
    tileImage: includeImage ? state.tileImage ?? null : null,
  };
}

function serializeSessionState(state, includeImage) {
  return {
    ...serializeState(state, includeImage),
    activeProfile: normalizeActiveProfile(state.activeProfile),
  };
}

function serializeProfile(profile, includeImage) {
  return {
    id: profile.id,
    name: profile.name,
    createdAt: profile.createdAt,
    ...serializeState(profile, includeImage),
  };
}

function normalizeActiveProfile(activeProfile) {
  if (!activeProfile || typeof activeProfile !== 'object') return null;
  if (typeof activeProfile.id !== 'string' || !activeProfile.id) return null;
  return {
    id: activeProfile.id,
    name: typeof activeProfile.name === 'string' ? activeProfile.name : '',
  };
}

function validateImportedProfile(raw, index) {
  const label = `Profile ${index + 1}`;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`${label}: expected a profile object.`);
  }
  if (typeof raw.name !== 'string' || !raw.name.trim()) {
    throw new Error(`${label}: name is required.`);
  }

  const roomWidth = Number(raw.roomWidth);
  const roomLength = Number(raw.roomLength);
  const panelWidth = Number(raw.panelWidth);
  const panelLength = Number(raw.panelLength);
  const offsetWidth = Number(raw.offsetWidth) || 0;
  const offsetLength = Number(raw.offsetLength) || 0;
  const orientation = Number(raw.orientation);

  if (!(roomWidth > 0)) throw new Error(`${label}: room width must be greater than 0.`);
  if (!(roomLength > 0)) throw new Error(`${label}: room length must be greater than 0.`);
  if (!(panelWidth > 0)) throw new Error(`${label}: panel width must be greater than 0.`);
  if (!(panelLength > 0)) throw new Error(`${label}: panel length must be greater than 0.`);
  if (offsetWidth < 0) throw new Error(`${label}: left cut cannot be negative.`);
  if (offsetLength < 0) throw new Error(`${label}: top cut cannot be negative.`);
  if (orientation !== 0 && orientation !== 90) {
    throw new Error(`${label}: orientation must be 0 or 90.`);
  }

  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : crypto.randomUUID(),
    name: raw.name.trim(),
    createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : Date.now(),
    roomWidth,
    roomLength,
    panelWidth,
    panelLength,
    orientation,
    offsetWidth,
    offsetLength,
    alternating: Boolean(raw.alternating),
    doors: Array.isArray(raw.doors) ? raw.doors : [],
    tileImage: normalizeImportedTileImage(raw.tileImage),
  };
}

function normalizeImportedTileImage(tileImage) {
  if (tileImage == null) return null;
  if (typeof tileImage !== 'object' || typeof tileImage.dataUrl !== 'string') return null;
  if (!tileImage.dataUrl.startsWith('data:image/')) return null;
  return {
    dataUrl: tileImage.dataUrl,
    name: typeof tileImage.name === 'string' ? tileImage.name : '',
  };
}

function uniquifyProfileName(name, usedNames) {
  if (!usedNames.has(name.toLowerCase())) return name;

  let suffix = 2;
  while (usedNames.has(`${name} (${suffix})`.toLowerCase())) suffix += 1;
  return `${name} (${suffix})`;
}

function writeJson(key, value, onQuotaExceeded) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return { ok: true };
  } catch (err) {
    if (err?.name === 'QuotaExceededError' && onQuotaExceeded) {
      return onQuotaExceeded();
    }
    return { ok: false, warn: 'Could not write to browser storage.' };
  }
}
