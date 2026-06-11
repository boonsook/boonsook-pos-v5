const PREFIX = "bsk_service_draft:";

function keyOf(name) {
  return PREFIX + name;
}

export function loadServiceDraft(name) {
  try {
    const raw = localStorage.getItem(keyOf(name));
    return raw ? JSON.parse(raw) : null;
  } catch (_) {
    return null;
  }
}

export function saveServiceDraft(name, draft) {
  try {
    localStorage.setItem(keyOf(name), JSON.stringify({ ...draft, savedAt: new Date().toISOString() }));
  } catch (_) {}
}

export function clearServiceDraft(name) {
  try { localStorage.removeItem(keyOf(name)); } catch (_) {}
}

export function collectDraftFields(container, fields) {
  const out = {};
  fields.forEach(([selector, prop]) => {
    const el = container.querySelector(selector);
    if (el) out[prop] = el.value;
  });
  return out;
}

export function applyDraftFields(container, draft, fields) {
  const values = draft?.fields || {};
  fields.forEach(([selector, prop]) => {
    const el = container.querySelector(selector);
    if (el && values[prop] !== undefined) el.value = values[prop];
  });
}

export function bindServiceDraft(container, name, fields, getExtra = () => ({})) {
  const save = () => {
    const extra = getExtra();
    if (extra === false) return;
    saveServiceDraft(name, {
      fields: collectDraftFields(container, fields),
      ...extra
    });
  };
  container.addEventListener("input", save);
  container.addEventListener("change", save);
  return save;
}
