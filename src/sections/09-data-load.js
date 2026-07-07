export function idOf(v) {
  return String(typeof v === 'object' && v ? v.id : v);
}

// Draw kind of a graph node (§9.2): 'node' = simulated graph node, 'cluster'
// = hull. v2 nodes carry `kind` from the view's render mode; legacy v1 nodes
// fall back to their structural tag.
export function drawKindOf(n) {
  if (!n) return null;
  if (n.kind) return n.kind;
  return n.type === 'org' ? 'cluster' : 'node';
}

let allowedOrgs = new Set();

/* v8 ignore start */
export function renderFullView(sourceName) {
  populateCombo("");
  // Globalen OE-Baum einmalig aufbauen; Sichtbarkeit wird separat über applyLegendScope gesteuert
  buildOrgLegend();
  // Initialer Zustand: kein Scope -> alle OEs ausgeblendet
  applyLegendScope(new Set());
  buildHiddenLegend();
  setStatus(sourceName);
  updateFooterStats(null);
}
/* v8 ignore stop */

export async function loadEnvConfig() {
  // Verwende Logger hier noch nicht, da debugMode möglicherweise noch false ist, aber wir wollen es erzwingen, wenn die Config es sagt.
  // Wir loggen "Start" nachträglich, falls debugMode aktiviert wird.
  
  try {
    // 1) IndexedDB (standalone persistence)
    const storedEnv = await getStoredJson(KEY_ENV);
    if (storedEnv) {
      envConfig = storedEnv;
      if (typeof envConfig.TOOLBAR_DEBUG_ACTIVE === 'boolean') {
        debugMode = envConfig.TOOLBAR_DEBUG_ACTIVE;
      }
      Logger.log('[Init] env loaded from IndexedDB:', envConfig);
      return true;
    }
    // 2) fetch fallback (dev server only — file:// cannot fetch, and the
    // offline single-file mode must stay console-clean, NFR-8)
    if (typeof location !== 'undefined' && location.protocol === 'file:') {
      envConfig = null;
      setStatus('Keine Konfiguration im Profil – Registry, env.json und Snapshot per Drag & Drop laden.');
      return false;
    }
    const res = await fetch("./env.json", { cache: "no-store" });
    if (res.ok) {
      envConfig = await res.json();

      // Update debug mode from config [SF]
      if (typeof envConfig.TOOLBAR_DEBUG_ACTIVE === 'boolean') {
        debugMode = envConfig.TOOLBAR_DEBUG_ACTIVE;
      }
      Logger.log('[Init] env.json loaded:', envConfig);
      return true;
    } else {
      // Keine gültige env.json gefunden (HTTP-Fehler)
      console.warn('env.json konnte nicht geladen werden:', res.status, res.statusText);
      setStatus('Keine gültige env.json gefunden – Dateien per Drag & Drop laden.');
      showTemporaryNotification('env.json konnte nicht geladen werden – bitte Datei prüfen oder per Drag & Drop laden.', 5000);
    }
  } catch (e) {
    // Fehler beim Laden oder Parsen von env.json
    console.error('Fehler beim Laden von env.json:', e);
    setStatus('Fehler beim Laden von env.json – Dateien per Drag & Drop laden.');
    showTemporaryNotification('env.json ist ungültig oder konnte nicht gelesen werden (z.B. JSON-Syntaxfehler). Bitte Datei prüfen.', 5000);
  }
  envConfig = null;
  Logger.log('[Timing] End: init.loadEnv');
  return false;
}

export async function loadData() {
  setStatus("Lade Daten...");

  // OrgGraph 2.0 tenant (registry present in this profile): the v2 boot path
  // owns loading — snapshots/store instead of the legacy dataset (§1.5).
  try {
    if (typeof og2TryBoot === 'function' && await og2TryBoot()) {
      setStatus('OrgGraph 2.0 Tenant geladen.');
      return true;
    }
  } catch (e) {
    console.error('OrgGraph 2.0 Boot fehlgeschlagen:', e);
    setStatus('OrgGraph 2.0 Boot fehlgeschlagen — Details in der Konsole.');
    return false;
  }

  // No v2 tenant present: the app renders nothing legacy — data enters via
  // registry/env/snapshot drops only; legacy datasets migrate via
  // scripts/migrate-legacy.mjs (PRD §9.3/§10, E25/FR-6.7). A stored legacy
  // config is named explicitly so a stale profile never fails silently.
  const legacyEnvStored = envConfig && (envConfig.DATA_ATTRIBUTES_URL !== undefined
    || envConfig.DATA_ATTRIBUTES_DIR !== undefined);
  // A v2 env without a tenant registry is the most likely half-loaded state
  // (live-test finding): name the missing piece, never the generic hint.
  const registryStored = await getStoredJson(KEY_REGISTRY);
  if (!legacyEnvStored && envConfig && envConfig.VIEWS && !registryStored) {
    setStatus('Typ-Registry fehlt: bitte schema/registry.json zusätzlich per Drag & Drop laden — env und Snapshots sind gespeichert und warten auf den Import.');
    return false;
  }
  if (legacyEnvStored) {
    setStatus('Legacy-v1-Konfiguration im Profil erkannt — bitte Daten zurücksetzen (Footer) und die migrierte env.json samt Registry und Snapshot laden (scripts/migrate-legacy.mjs).');
  } else {
    setStatus('Kein OrgGraph-2.0-Tenant: Registry, env.json und Snapshot laden (Drag & Drop). Legacy-Daten mit scripts/migrate-legacy.mjs migrieren.');
  }
  return false;
}
