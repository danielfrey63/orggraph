// OrgGraph 2.0 — list intake dialog (PRD E74): the in-app counterpart of the
// former attribute upload. A dropped identifier list (.txt/.tsv/.csv) is
// parked in the profile (04-storage, LIST_PREFIX) and handled here: choose
// the target (edge type → target type), category and value — existing ones
// offered, new ones typed —, confirm fuzzy proposals, then the list becomes
// an enrichment snapshot (31-og2-intake) that runs through the regular import
// with its product HIL dialogs (source registration E70, join gate E69,
// plausibility gate FR-5.7). The store is adopted in place, no reload.
import { showTemporaryNotification } from './01-config-status.js';
import { getPendingLists, delStored } from './04-storage.js';
import { createModal } from './03-export-dialog.js';
import { importSnapshotAsync } from './26-og2-import.js';
import { validateView } from './27-og2-path.js';
import { parseListText, buildIdentifierFingerprint, buildIdentityResolver, listSourceId, priorEdgeSources, listEdgeTypes, existingTargets, buildListSnapshot, extendPathWithRing } from './31-og2-intake.js';
import { og2State, og2ActiveView, og2UiHooks, og2AdoptStore, og2ReplaceViews } from './30-og2-ui.js';

let og2IntakeOpen = false;

// Open the intake dialog for every parked list, one after the other.
export async function og2OpenPendingLists() {
  if (og2IntakeOpen || !og2State()) return;
  const pending = await getPendingLists();
  if (!pending.length) return;
  og2IntakeOpen = true;
  try {
    // The identifier column is found by fingerprint (E74): exact known
    // identifiers and patterns derived from them, learned from the stock of
    // the type carrying an `identifiers` capability.
    const { registry, store } = og2State();
    const fpType = (Object.entries(registry.nodeTypes || {}).find(([, d]) => Array.isArray(d.identifiers) && d.identifiers.length) || [null])[0];
    const fingerprint = fpType ? buildIdentifierFingerprint(store, registry, fpType) : null;
    for (const entry of pending) {
      // one dialog per list: a wide table (E74) yields one list per
      // attribute column; the parked file is consumed once all are handled
      const { lists, detected } = parseListText(entry.text, fileStemOf(entry.filename), fingerprint);
      if (!lists.length) showTemporaryNotification(`Liste ${entry.filename}: keine Einträge gefunden.`, 'medium');
      for (let i = 0; i < lists.length; i++) {
        await new Promise((resolve) => showListIntakeDialog(entry, lists[i], { index: i + 1, total: lists.length, detected }, resolve));
      }
      await delStored(entry.key);
    }
  } finally {
    og2IntakeOpen = false;
  }
}

/* v8 ignore start */
function fileStemOf(filename) {
  return String(filename || '').replace(/\.[^.]+$/, '');
}

// Member type of a list: the edge's declared `from` when it is one type,
// otherwise the first registry type with an `identifiers` capability.
function memberTypeOf(registry, edgeDecl) {
  if (edgeDecl && typeof edgeDecl.from === 'string' && edgeDecl.from !== '*') return edgeDecl.from;
  const withIds = Object.entries(registry.nodeTypes || {}).find(([, d]) => Array.isArray(d.identifiers) && d.identifiers.length);
  return withIds ? withIds[0] : null;
}

function downloadJson(filename, obj) {
  const blob = new Blob([JSON.stringify(obj, null, 2) + '\n'], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function formRow(form, labelText, control, { span = false } = {}) {
  if (span) {
    control.classList.add('modal-form-span');
    form.appendChild(control);
    return control;
  }
  const label = document.createElement('label');
  label.textContent = labelText;
  form.append(label, control);
  return control;
}

function textInput({ value = '', placeholder = '', list = null } = {}) {
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'modal-input';
  input.value = value;
  input.placeholder = placeholder;
  if (list) input.setAttribute('list', list);
  return input;
}

function datalist(id, values) {
  const dl = document.createElement('datalist');
  dl.id = id;
  for (const v of values) {
    const opt = document.createElement('option');
    opt.value = v;
    dl.appendChild(opt);
  }
  return dl;
}

function fillDatalist(dl, values) {
  dl.innerHTML = '';
  for (const v of values) {
    const opt = document.createElement('option');
    opt.value = v;
    dl.appendChild(opt);
  }
}

function checkbox(labelText, checked) {
  const wrap = document.createElement('label');
  wrap.className = 'modal-check';
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.checked = !!checked;
  const text = document.createElement('span');
  text.textContent = labelText;
  wrap.append(box, text);
  return { wrap, box };
}

export function showListIntakeDialog(entry, list, meta, onDone) {
  const og2 = og2State();
  const { registry, store } = og2;
  const stem = list.category || fileStemOf(entry.filename);
  const parsed = { rows: list.rows };
  const rowsCarryValues = parsed.rows.some((r) => r.value);
  const rowsCarryCategories = parsed.rows.some((r) => r.category);
  const titleSuffix = meta && meta.total > 1 ? ` — Spalte «${list.category}» (${meta.index}/${meta.total})` : '';

  // Default target: the generic attribute carrier when the registry has one
  // (an edge whose target type groups the legend by a property), else the
  // first edge type; the member type follows the chosen edge.
  const allEdgeTypes = Object.entries(registry.edgeTypes || {});
  const defaultEdge = (allEdgeTypes.find(([, d]) => {
    const t = (registry.nodeTypes || {})[d.to] || {};
    return typeof d.to === 'string' && t.groupProp;
  }) || allEdgeTypes[0] || [null])[0];

  const finish = (result) => { if (onDone) onDone(result); };
  const { modal, content, close } = createModal({ id: 'listIntakeDialog', title: `Liste importieren: ${entry.filename}${titleSuffix}` });
  modal.querySelector('.modal-container').classList.add('modal-container--wide');

  const form = document.createElement('div');
  form.className = 'modal-form';

  // --- target (edge type → target type)
  const edgeSelect = document.createElement('select');
  edgeSelect.className = 'modal-input';
  let memberType = memberTypeOf(registry, registry.edgeTypes[defaultEdge]);
  const rebuildEdgeOptions = () => {
    edgeSelect.innerHTML = '';
    const choices = listEdgeTypes(registry, memberType);
    for (const c of choices) {
      const opt = document.createElement('option');
      opt.value = c.edgeType;
      opt.textContent = `${c.edgeType} → ${c.targetType}${c.groupProp ? ' (Kategorie + Wert)' : ''}`;
      edgeSelect.appendChild(opt);
    }
    if (choices.some((c) => c.edgeType === defaultEdge)) edgeSelect.value = defaultEdge;
  };
  rebuildEdgeOptions();
  formRow(form, 'Ziel', edgeSelect);

  // --- category + value with existing choices
  const catList = datalist('listIntakeCategories', []);
  const valList = datalist('listIntakeValues', []);
  const catInput = textInput({ value: stem, placeholder: 'Kategorie (Listenname)', list: catList.id });
  const valInput = textInput({ value: '', placeholder: 'leer = die Kategorie selbst', list: valList.id });
  formRow(form, 'Kategorie', catInput);
  formRow(form, 'Wert', valInput);
  if (rowsCarryValues) {
    valInput.disabled = true;
    valInput.value = `aus Datei (${new Set(parsed.rows.map((r) => r.value)).size} verschiedene)`;
  }
  if (rowsCarryCategories) {
    catInput.disabled = true;
    catInput.value = `aus Datei (${new Set(parsed.rows.map((r) => r.category || stem)).size} verschiedene)`;
  }
  form.append(catList, valList);

  // --- source id (one source per list = full-state semantics per attribute)
  const srcInput = textInput({ value: listSourceId(stem), placeholder: 'quelle-id' });
  let srcTouched = false;
  srcInput.addEventListener('input', () => { srcTouched = true; });
  formRow(form, 'Quelle', srcInput);

  const currentTargetType = () => (registry.edgeTypes[edgeSelect.value] || {}).to;
  const targetHasGroup = () => !!((registry.nodeTypes || {})[currentTargetType()] || {}).groupProp;
  const refreshChoices = () => {
    const targets = existingTargets(store, registry, currentTargetType());
    const groups = [...new Set(targets.map((t) => t.group))];
    fillDatalist(catList, groups);
    const cat = catInput.value.trim();
    const labels = targets.filter((t) => !targetHasGroup() || t.group === cat).map((t) => t.label);
    fillDatalist(valList, [...new Set(labels)]);
    // without a grouping property the category only names the list (id/source)
    catInput.placeholder = targetHasGroup() ? 'Kategorie (Listenname)' : 'Listenname (nur Kennung)';
  };
  edgeSelect.addEventListener('change', () => {
    memberType = memberTypeOf(registry, registry.edgeTypes[edgeSelect.value]) || memberType;
    refreshChoices();
    rematch();
  });
  catInput.addEventListener('input', () => {
    if (!srcTouched) srcInput.value = listSourceId(catInput.value.trim() || stem);
    refreshChoices();
  });
  refreshChoices();

  // --- matching
  const summary = document.createElement('div');
  summary.className = 'modal-summary';
  // how the identifier column was found (fingerprint vs. header/position)
  const detectNote = document.createElement('div');
  detectNote.className = 'modal-note';
  const det = meta && meta.detected;
  detectNote.textContent = det
    ? `Identifikator-Spalte erkannt: «${det.header ? det.label : `Spalte ${det.column + 1}`}» — ${det.exact} bekannt, ${det.pattern} nach Muster, von ${det.nonEmpty}.`
    : 'Identifikator-Spalte nach Kopfzeile bzw. Position gewählt (keine Muster aus dem Bestand anwendbar).';
  const matches = document.createElement('div');
  matches.className = 'intake-matches';
  const decisions = new Map(); // identifier -> id | null
  let resolver = null;
  let resolutions = [];
  const rematch = () => {
    resolver = buildIdentityResolver(store, registry, memberType);
    resolutions = parsed.rows.map((r) => ({ row: r, res: resolver.resolve(r.identifier) }));
    decisions.clear();
    matches.innerHTML = '';
    let exact = 0, fuzzy = 0, open = 0;
    for (const { row, res } of resolutions) {
      if (res.status === 'exact') { exact++; decisions.set(row.identifier, res.id); continue; }
      const line = document.createElement('div');
      line.className = 'intake-match' + (res.candidates.length ? '' : ' intake-match--unmatched');
      const id = document.createElement('span');
      id.className = 'intake-match-id';
      id.textContent = row.identifier;
      id.title = row.identifier;
      line.appendChild(id);
      if (res.candidates.length) {
        const sel = document.createElement('select');
        sel.className = 'modal-input';
        const none = document.createElement('option');
        none.value = '';
        none.textContent = 'nicht zuordnen';
        sel.appendChild(none);
        for (const c of res.candidates) {
          const opt = document.createElement('option');
          opt.value = c.id;
          opt.textContent = `${c.label} (${Math.round((1 - c.dist) * 100)} %)`;
          sel.appendChild(opt);
        }
        sel.value = res.status === 'fuzzy' ? res.id : '';
        decisions.set(row.identifier, sel.value || null);
        if (res.status === 'fuzzy') fuzzy++; else open++;
        sel.addEventListener('change', () => { decisions.set(row.identifier, sel.value || null); updateSummary(); });
        line.appendChild(sel);
      } else {
        const none = document.createElement('span');
        none.className = 'modal-note';
        none.textContent = 'kein Treffer';
        line.appendChild(none);
        decisions.set(row.identifier, null);
        open++;
      }
      matches.appendChild(line);
    }
    matches.hidden = matches.childElementCount === 0;
    updateSummary(exact, fuzzy, open);
  };
  let counts = { exact: 0, fuzzy: 0, open: 0 };
  const updateSummary = (exact, fuzzy, open) => {
    if (exact !== undefined) counts = { exact, fuzzy, open };
    const assigned = [...decisions.values()].filter(Boolean).length;
    summary.textContent = `${parsed.rows.length} Zeilen · ${counts.exact} exakt · ${counts.fuzzy} Vorschläge · ${counts.open} offen → ${assigned} werden importiert`;
    importBtn.disabled = assigned === 0;
  };

  // --- view hop + download
  const view = og2ActiveView(og2);
  const extendCheck = checkbox('', true);
  const refreshExtend = () => {
    const edgeType = edgeSelect.value;
    const targetType = currentTargetType();
    const next = view ? extendPathWithRing(view.path, memberType, edgeType, targetType) : null;
    const ok = next && validateView({ ...view, path: next }, registry).ok;
    extendCheck.wrap.hidden = !ok;
    extendCheck.wrap.dataset.path = ok ? next : '';
    extendCheck.wrap.querySelector('span').textContent = `View «${og2.activeViewName}» um Ring ${edgeType} → ${targetType} erweitern`;
  };
  edgeSelect.addEventListener('change', refreshExtend);
  const dlCheck = checkbox('Snapshot-Datei zusätzlich herunterladen', false);

  const error = document.createElement('div');
  error.className = 'modal-error';

  const btnRow = document.createElement('div');
  btnRow.className = 'modal-btn-row';
  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'btn';
  cancelBtn.textContent = 'Verwerfen';
  const importBtn = document.createElement('button');
  importBtn.type = 'button';
  importBtn.className = 'btn-primary';
  importBtn.textContent = 'Importieren';
  btnRow.append(cancelBtn, importBtn);

  content.append(form, summary, detectNote, matches, extendCheck.wrap, dlCheck.wrap, error, btnRow);
  rematch();
  refreshExtend();

  const discard = () => {
    showTemporaryNotification(`Liste ${entry.filename}${titleSuffix} verworfen — nichts importiert.`);
    finish({ status: 'discarded' });
  };
  cancelBtn.addEventListener('click', () => { close(); discard(); });
  modal.querySelector('.modal-close-btn').addEventListener('click', discard);

  importBtn.addEventListener('click', async () => {
    error.textContent = '';
    importBtn.disabled = true;
    try {
      const edgeType = edgeSelect.value;
      const category = rowsCarryCategories ? stem : (catInput.value.trim() || stem);
      const value = rowsCarryValues ? '' : valInput.value.trim();
      const source = srcInput.value.trim();
      if (!/^[a-z][a-z0-9-]*$/.test(source)) throw new Error('Quelle muss dem Muster ^[a-z][a-z0-9-]*$ folgen (E62).');
      const built = buildListSnapshot({
        source, at: new Date().toISOString(), registry, rows: parsed.rows, category, value, edgeType, memberType,
        resolveId: (identifier) => decisions.get(identifier) || null,
        labelOf: resolver.labelOf,
        priorSources: priorEdgeSources(store, source, edgeType),
        existing: existingTargets(store, registry, currentTargetType()),
      });
      const res = await importSnapshotAsync(store, registry, built.snapshot, og2UiHooks());
      if (res.status !== 'imported') {
        const detail = res.errors ? res.errors.slice(0, 3).join('; ') : (res.reason || '');
        throw new Error(`${res.status === 'noop' ? 'Bereits importiert' : 'Import nicht angewendet'}${detail ? ': ' + detail : ''}`);
      }
      if (!extendCheck.wrap.hidden && extendCheck.box.checked && extendCheck.wrap.dataset.path) {
        const views = { ...(og2.env.VIEWS || {}) };
        views[og2.activeViewName] = { ...views[og2.activeViewName], path: extendCheck.wrap.dataset.path };
        delete views[og2.activeViewName].parsed;
        await og2ReplaceViews(views);
      }
      if (dlCheck.box.checked) downloadJson(`${source}.snapshot-${built.snapshot.meta.snapshot}.json`, built.snapshot);
      await og2AdoptStore(res.store || store, { revealRings: true });
      const skipped = built.unmatched.length ? `, ${built.unmatched.length} ohne Zuordnung übersprungen` : '';
      showTemporaryNotification(`Liste ${entry.filename}${titleSuffix} importiert: ${built.matched.length} Zuordnungen als ${edgeType}${skipped}.`, 'medium');
      close();
      finish({ status: 'imported', snapshot: built.snapshot });
    } catch (e) {
      console.warn('[intake] Import fehlgeschlagen:', e);
      error.textContent = String(e.message || e);
      importBtn.disabled = false;
    }
  });
}
/* v8 ignore stop */
