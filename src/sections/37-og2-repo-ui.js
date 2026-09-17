// OrgGraph 2.0 — tenant repo dialog (E77): bind the active profile to its
// private Gitea repo. Fields: Gitea URL, owner/repo, branch, token, age
// identity. "Verbindung testen" reads the repo and its config.json (are we a
// recipient?), "Speichern und abgleichen" pulls right away.
import { createModal } from './03-export-dialog.js';
import { og2RepoConfigRaw, og2SaveRepoConfig, og2SyncPull, og2SyncPush, og2AgeGenerateIdentity, og2AgeRecipientOf, og2SyncStatus } from './35-og2-sync.js';
import { giteaClient, normalizeRepoConfig, repoConfigComplete } from './36-og2-gitea.js';

/* v8 ignore start */
function field(form, label, { type = 'text', value = '', placeholder = '', note = '' } = {}) {
  const lab = document.createElement('label');
  lab.textContent = label;
  const input = document.createElement('input');
  input.type = type;
  input.className = 'modal-input';
  input.value = value;
  input.placeholder = placeholder;
  input.autocomplete = 'off';
  input.spellcheck = false;
  form.append(lab, input);
  if (note) { const n = document.createElement('span'); n.className = 'modal-note modal-form-span'; n.textContent = note; form.append(n); }
  return input;
}

export async function og2OpenRepoDialog() {
  if (document.getElementById('og2RepoDialog')) return;
  const current = (await og2RepoConfigRaw()) || {};
  const { modal, content, close } = createModal({ id: 'og2RepoDialog', title: 'Mandanten-Repo verbinden' });
  modal.querySelector('.modal-container').classList.add('modal-container--wide');
  const intro = document.createElement('p');
  intro.className = 'modal-summary';
  intro.textContent = 'Das aktive Profil wird an ein privates Gitea-Repo gebunden: beim Laden wird der Stand geholt, nach jeder Änderung als Commit abgelegt — age-verschlüsselt im Browser. Token und Schlüssel bleiben in diesem Profil (E77).';
  const form = document.createElement('div');
  form.className = 'modal-form';
  const base = field(form, 'Gitea-URL', { value: current.base || '', placeholder: 'https://git.example.ch' });
  const owner = field(form, 'Owner / Repo', { value: current.owner && current.repo ? `${current.owner}/${current.repo}` : (current.owner || ''), placeholder: 'daniel/orggraph-sem' });
  const branch = field(form, 'Branch', { value: current.branch || 'main' });
  const token = field(form, 'Zugriffs-Token', { type: 'password', value: current.token || '', placeholder: 'Gitea → Einstellungen → Anwendungen → Token (Scope: repository schreiben)' });
  const identity = field(form, 'age-Identität', { type: 'password', value: current.identity || '', placeholder: 'AGE-SECRET-KEY-1…', note: 'Privater Schlüssel zum Entschlüsseln. Der öffentliche Teil muss als Empfänger in config.json des Repos stehen.' });

  const pub = document.createElement('div');
  pub.className = 'modal-note';
  const showPub = async () => {
    try { const r = identity.value.trim() ? await og2AgeRecipientOf(identity.value.trim()) : null; pub.textContent = r ? `Öffentlicher Schlüssel (Empfänger): ${r}` : ''; }
    catch { pub.textContent = 'age-Identität ungültig'; }
  };
  identity.addEventListener('input', showPub);
  await showPub();

  const result = document.createElement('pre');
  result.className = 'modal-detail';
  result.hidden = true;
  const say = (text) => { result.hidden = false; result.textContent = text; };
  const error = document.createElement('div');
  error.className = 'modal-error';

  const readForm = () => {
    const [o, r] = owner.value.trim().split('/');
    return normalizeRepoConfig({ base: base.value, owner: o || '', repo: r || '', branch: branch.value, token: token.value, identity: identity.value });
  };

  const btnRow = document.createElement('div');
  btnRow.className = 'modal-btn-row';
  const mk = (label, cls = 'btn') => { const b = document.createElement('button'); b.type = 'button'; b.className = cls; b.textContent = label; btnRow.appendChild(b); return b; };
  const genBtn = mk('Identität erzeugen');
  const testBtn = mk('Verbindung testen');
  const unbindBtn = mk('Trennen');
  const saveBtn = mk('Speichern');
  const syncBtn = mk('Speichern und abgleichen', 'btn-primary');

  genBtn.addEventListener('click', async () => {
    if (identity.value.trim() && !(await og2AskDialog({ title: 'Identität ersetzen?', intro: 'Ohne den alten Schlüssel sind damit verschlüsselte Stände nicht mehr lesbar.', detail: identity.value.trim().slice(0, 24) + '…', confirmLabel: 'Ersetzen' }))) return;
    identity.value = await og2AgeGenerateIdentity();
    identity.type = 'text';
    await showPub();
    say('Neue Identität erzeugt. Den privaten Schlüssel sicher ablegen (z. B. ~/.config/orggraph/age-identity.txt) und den öffentlichen Schlüssel in config.json des Repos als Empfänger eintragen — bei einem leeren Repo schreibt der erste Commit config.json selbst.');
  });

  testBtn.addEventListener('click', async () => {
    error.textContent = '';
    const cfg = readForm();
    if (!repoConfigComplete(cfg)) { error.textContent = 'URL, Owner/Repo und Token sind nötig.'; return; }
    testBtn.disabled = true;
    try {
      const client = giteaClient(cfg);
      const repo = await client.repo();
      if (!repo) throw new Error('Repo nicht gefunden (Owner/Repo prüfen, Token-Rechte?)');
      const listing = await client.list('');
      const names = listing.map((e) => e.name);
      const conf = names.includes('config.json') ? await client.readText('config.json') : null;
      const recipients = conf ? (JSON.parse(conf.text).recipients || []) : [];
      const own = cfg.identity ? await og2AgeRecipientOf(cfg.identity) : null;
      const manifest = names.includes('manifest.json') ? JSON.parse((await client.readText('manifest.json')).text) : null;
      say([
        `Repo: ${repo.full_name} (${repo.private ? 'privat' : 'ÖFFENTLICH!'}), Branch ${cfg.branch}`,
        `Dateien: ${names.join(', ') || '(leer)'}`,
        `Empfänger in config.json: ${recipients.length ? recipients.join(', ') : '(keine — erster Commit legt config.json an)'}`,
        own ? (recipients.includes(own) || !recipients.length ? 'Eigener Schlüssel ist Empfänger: ja' : 'Eigener Schlüssel ist Empfänger: NEIN — Stände des Repos sind hier nicht lesbar') : 'Keine Identität hinterlegt: Pull unmöglich, Push nur mit vorhandenen Empfängern',
        manifest ? `Letzter Export: ${manifest.exportedAt} (${manifest.counts ? manifest.counts.nodes + ' Knoten' : '?'}, ${manifest.reason || ''})` : 'Noch kein Export im Repo',
      ].join('\n'));
    } catch (e) {
      error.textContent = e.message;
    } finally { testBtn.disabled = false; }
  });

  const save = async () => {
    const cfg = readForm();
    if (!repoConfigComplete(cfg)) { error.textContent = 'URL, Owner/Repo und Token sind nötig.'; return null; }
    await og2SaveRepoConfig(cfg);
    og2SyncStatus('ok', 'Repo: verbunden');
    return cfg;
  };
  saveBtn.addEventListener('click', async () => { if (await save()) { close(); showTemporaryNotification('Mandanten-Repo gespeichert — beim nächsten Laden wird abgeglichen.'); } });
  syncBtn.addEventListener('click', async () => {
    if (!(await save())) return;
    syncBtn.disabled = true;
    const res = await og2SyncPull({ force: false });
    if (res.restored) { setStatus(`Stand ${res.manifest.exportedAt} aus dem Repo übernommen – lade neu …`); location.reload(); return; }
    if (res.error) { error.textContent = res.error; syncBtn.disabled = false; return; }
    // nothing to pull: push what we have when the repo has no export yet
    if (res.reason === 'repo has no export' && typeof og2State === 'function' && og2State()) await og2SyncPush('initial push');
    close();
  });
  unbindBtn.addEventListener('click', async () => {
    if (!(await og2AskDialog({ title: 'Verbindung trennen?', intro: 'Daten im Repo bleiben, Token und Schlüssel werden aus diesem Profil entfernt.', detail: `${base.value.trim()} ${owner.value.trim()}`, confirmLabel: 'Trennen' }))) return;
    await og2SaveRepoConfig(null);
    og2SyncStatus('off', 'Repo: nicht verbunden');
    close();
  });

  content.append(intro, form, pub, result, error, btnRow);
  base.focus();
}
/* v8 ignore stop */
