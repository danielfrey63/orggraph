#!/usr/bin/env python3
"""OrgGraph tenant repo CLI (E77): one private git repo per tenant, age-encrypted.

The app itself syncs through Gitea's REST API (see src/sections/35-og2-sync.js):
every change is a server-side commit, every load pulls. This CLI is the
command-line side of the same repo — creating it, archiving files by hand,
decrypting a stand, checking the state — through a local clone.

  python tools/tenant_repo.py keygen                     # age identity (once per machine)
  python tools/tenant_repo.py init sem --repo <dir> [--remote <url>] [--create-remote]
  python tools/tenant_repo.py push sem <file>            # tenant ZIP (export) or raw snapshot
  python tools/tenant_repo.py restore sem --out <dir>    # decrypt the latest tenant ZIP + snapshots
  python tools/tenant_repo.py bundle sem --out <dir>     # numbered drop ZIPs for a from-scratch rebuild
  python tools/tenant_repo.py status [sem]
  python tools/tenant_repo.py selftest

Tenant repo layout (identical to what the app writes through the API):
  config.json        tenant name + age recipients (plain)
  manifest.json      what the latest export is (plain, diffable)
  tenant.zip.age     the app's tenant export (registry, env, store, manifest)
  snapshots/*.age    raw inputs the app received (crawl exports, lists)

Config: ~/.config/orggraph/hub.json (override: ORGGRAPH_HUB_CONFIG)
  { "identity": "<age key file>", "tenants": { "sem": { "repo": "<tenant repo dir>" } } }
"""
import argparse
import io
import json
import os
import re
import subprocess
import sys
import tempfile
import threading
import time
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse
from urllib.request import Request, urlopen

CLI_VERSION = 'tenant-repo-1'
CONFIG_PATH = Path(os.environ.get('ORGGRAPH_HUB_CONFIG', str(Path.home() / '.config' / 'orggraph' / 'hub.json')))
DEFAULT_IDENTITY = Path.home() / '.config' / 'orggraph' / 'age-identity.txt'
PULL_THROTTLE_S = 20
EXPORT_FILE = 'tenant.zip.age'
MANIFEST_FILE = 'manifest.json'
TENANT_CONFIG_FILE = 'config.json'
SNAPSHOT_DIR = 'snapshots'


def now_iso():
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace('+00:00', 'Z')


def log(msg):
    print(f'[hub {datetime.now().strftime("%H:%M:%S")}] {msg}', flush=True)


# ---- config ------------------------------------------------------------------
def load_config():
    if CONFIG_PATH.exists():
        return json.loads(CONFIG_PATH.read_text(encoding='utf-8'))
    return {'identity': str(DEFAULT_IDENTITY), 'tenants': {}}


def save_config(cfg):
    CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
    CONFIG_PATH.write_text(json.dumps(cfg, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')


# ---- age ---------------------------------------------------------------------
def _pyrage():
    try:
        import pyrage
        from pyrage import x25519
        return pyrage, x25519
    except ImportError:
        sys.exit('pyrage fehlt: pip install pyrage')


def ensure_identity(path):
    """Create an age identity file (age-keygen format) when missing; return its public key."""
    pyrage, x25519 = _pyrage()
    path = Path(path)
    if path.exists():
        return identity_public(path)
    ident = x25519.Identity.generate()
    pub = str(ident.to_public())
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(f'# created: {now_iso()}\n# public key: {pub}\n{ident}\n', encoding='utf-8')
    try:
        os.chmod(path, 0o600)
    except OSError:
        pass
    return pub


def load_identity(path):
    _, x25519 = _pyrage()
    for line in Path(path).read_text(encoding='utf-8').splitlines():
        if line.startswith('AGE-SECRET-KEY-'):
            return x25519.Identity.from_str(line.strip())
    raise SystemExit(f'kein AGE-SECRET-KEY in {path}')


def identity_public(path):
    return str(load_identity(path).to_public())


def age_encrypt(data, recipients):
    pyrage, x25519 = _pyrage()
    return pyrage.encrypt(data, [x25519.Recipient.from_str(r) for r in recipients])


def age_decrypt(data, identity):
    pyrage, _ = _pyrage()
    return pyrage.decrypt(data, [identity])


# ---- tenant repo --------------------------------------------------------------
SAFE_NAME = re.compile(r'[^A-Za-z0-9._@-]+')


def safe_filename(name):
    base = os.path.basename(name.replace('\\', '/'))
    base = SAFE_NAME.sub('_', base).strip('._') or 'file'
    return base[:180]


class Tenant:
    def __init__(self, name, repo, identity_path):
        self.name = name
        self.repo = Path(repo)
        self.identity_path = Path(identity_path)
        self.lock = threading.RLock()
        self.last_pull = 0.0

    # -- git
    def git(self, *args, check=True):
        res = subprocess.run(['git', *args], cwd=self.repo, capture_output=True, text=True, encoding='utf-8', errors='replace')
        if check and res.returncode != 0:
            raise RuntimeError(f'git {" ".join(args)}: {res.stderr.strip() or res.stdout.strip()}')
        return res

    def has_remote(self):
        return bool(self.git('remote', check=False).stdout.strip())

    def has_upstream(self):
        return self.git('rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}', check=False).returncode == 0

    def pull(self, force=False):
        """Pull before reading (throttled). Never raises: a failed pull is logged and reported."""
        with self.lock:
            if not force and time.time() - self.last_pull < PULL_THROTTLE_S:
                return {'pulled': False, 'reason': 'throttled'}
            self.last_pull = time.time()
            if not self.has_remote() or not self.has_upstream():
                return {'pulled': False, 'reason': 'no remote'}
            res = self.git('pull', '--rebase', '--autostash', check=False)
            if res.returncode != 0:
                log(f'{self.name}: pull fehlgeschlagen: {res.stderr.strip()[:300]}')
                return {'pulled': False, 'reason': 'error', 'detail': res.stderr.strip()[:300]}
            return {'pulled': True, 'detail': res.stdout.strip()[:120]}

    def commit_push(self, message):
        with self.lock:
            self.git('add', '-A')
            if not self.git('status', '--porcelain', check=False).stdout.strip():
                return {'committed': False, 'pushed': False}
            self.git('commit', '-q', '-m', message)
            out = {'committed': True, 'pushed': False, 'remote': self.has_remote()}
            if out['remote']:
                push = self.git('push', '-q', check=False) if self.has_upstream() else self.git('push', '-q', '-u', 'origin', 'HEAD', check=False)
                if push.returncode != 0:
                    log(f'{self.name}: push fehlgeschlagen: {push.stderr.strip()[:300]}')
                    out['pushError'] = push.stderr.strip()[:300]
                else:
                    out['pushed'] = True
            return out

    # -- files
    def config(self):
        p = self.repo / TENANT_CONFIG_FILE
        return json.loads(p.read_text(encoding='utf-8')) if p.exists() else {'tenant': self.name, 'recipients': []}

    def manifest(self):
        p = self.repo / MANIFEST_FILE
        return json.loads(p.read_text(encoding='utf-8')) if p.exists() else None

    def recipients(self):
        recs = self.config().get('recipients') or []
        if not recs:
            raise RuntimeError(f'{self.name}: keine age-Empfänger in {TENANT_CONFIG_FILE}')
        return recs

    def encrypt_write(self, rel, data):
        target = self.repo / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(age_encrypt(data, self.recipients()))

    def decrypt_read(self, rel):
        p = self.repo / rel
        if not p.exists():
            return None
        return age_decrypt(p.read_bytes(), load_identity(self.identity_path))

    def store_export(self, zip_bytes, reason='export'):
        """A tenant ZIP from the app: must carry manifest.json; becomes tenant.zip.age."""
        try:
            with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
                names = zf.namelist()
                if MANIFEST_FILE not in names:
                    raise RuntimeError('tenant ZIP ohne manifest.json')
                inner = json.loads(zf.read(MANIFEST_FILE).decode('utf-8'))
        except zipfile.BadZipFile:
            raise RuntimeError('kein gültiges ZIP')
        with self.lock:
            self.pull()
            self.encrypt_write(EXPORT_FILE, zip_bytes)
            manifest = {**inner, 'tenant': self.name, 'storedAt': now_iso(), 'reason': reason, 'bytes': len(zip_bytes), 'cli': CLI_VERSION}
            (self.repo / MANIFEST_FILE).write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
            git = self.commit_push(f'{self.name}: {reason} ({inner.get("exportedAt", "?")})')
            return {**manifest, 'git': git}

    def store_snapshot(self, name, data, reason='snapshot'):
        rel = f'{SNAPSHOT_DIR}/{safe_filename(name)}.age'
        with self.lock:
            self.pull()
            self.encrypt_write(rel, data)
            git = self.commit_push(f'{self.name}: {reason} {safe_filename(name)}')
            return {'stored': rel, 'bytes': len(data), 'git': git}

    def export_bytes(self):
        return self.decrypt_read(EXPORT_FILE)

    def status(self):
        m = self.manifest()
        snaps = sorted(p.name[:-4] for p in (self.repo / SNAPSHOT_DIR).glob('*.age')) if (self.repo / SNAPSHOT_DIR).exists() else []
        head = self.git('log', '-1', '--format=%h %ad %s', '--date=short', check=False).stdout.strip()
        return {'tenant': self.name, 'repo': str(self.repo), 'remote': self.git('remote', 'get-url', 'origin', check=False).stdout.strip() or None,
                'head': head or None, 'manifest': m, 'snapshots': snaps}


def tenants_from(cfg):
    ident = cfg.get('identity') or str(DEFAULT_IDENTITY)
    return {name: Tenant(name, t['repo'], ident) for name, t in (cfg.get('tenants') or {}).items()}


# ---- init ----------------------------------------------------------------------
README = """# OrgGraph-Mandant «{name}»

Datenrepo eines OrgGraph-Mandanten (E77). Wahrheit ist der Tenant-Store der App; dieses Repo hält seinen jeweils letzten Export
plus die Rohdateien, die die App bekommen hat — alles age-verschlüsselt, nur `config.json` und `manifest.json` sind lesbar.

| Datei | Inhalt |
|---|---|
| `config.json` | Mandantenname und age-Empfänger (öffentliche Schlüssel) |
| `manifest.json` | Stand des letzten Exports: Zeitpunkt, App-Version, Zähler, Quellen |
| `tenant.zip.age` | Tenant-Export der App: `registry.json`, `env.json`, `store.json`, `manifest.json` |
| `snapshots/*.age` | Rohdateien (Crawl-Exporte, Listen), wie sie die App erhalten hat |

Die App schreibt und liest dieses Repo direkt über die Gitea-API (Pull bei jedem Laden, Commit nach jeder Änderung);
`tools/tenant_repo.py` des App-Repos ist der manuelle Weg (`push`, `restore`, `status`). Entschlüsseln kann nur, wer eine Identität zu einem der Empfänger hat.
"""


def gitea_create_repo(remote_url):
    """Create the remote repository through the Gitea API, credentials from git's credential helper."""
    u = urlparse(remote_url)
    owner, repo = u.path.strip('/').removesuffix('.git').split('/')[-2:]
    cred = subprocess.run(['git', 'credential', 'fill'], input=f'protocol={u.scheme}\nhost={u.netloc}\n\n', capture_output=True, text=True)
    fields = dict(line.split('=', 1) for line in cred.stdout.splitlines() if '=' in line)
    if 'password' not in fields:
        raise RuntimeError(f'keine Zugangsdaten für {u.netloc} im Credential-Helper')
    import base64
    auth = base64.b64encode(f'{fields["username"]}:{fields["password"]}'.encode()).decode()
    body = json.dumps({'name': repo, 'private': True, 'description': f'OrgGraph-Mandant {repo} (age-verschlüsselt)', 'auto_init': False}).encode()
    api = f'{u.scheme}://{u.netloc}/api/v1/user/repos'
    req = Request(api, data=body, method='POST', headers={'Authorization': f'Basic {auth}', 'Content-Type': 'application/json', 'Accept': 'application/json'})
    try:
        with urlopen(req, timeout=30) as res:
            data = json.loads(res.read().decode('utf-8'))
            return {'created': True, 'url': data.get('html_url'), 'owner': owner}
    except Exception as err:  # noqa: BLE001 — surfaced verbatim to the operator
        detail = getattr(err, 'read', lambda: b'')().decode('utf-8', 'replace')[:300] if hasattr(err, 'read') else str(err)
        if '409' in str(err) or 'already exists' in detail:
            return {'created': False, 'url': remote_url, 'owner': owner, 'note': 'existiert bereits'}
        raise RuntimeError(f'Gitea-API: {err} {detail}')


def cmd_init(args):
    cfg = load_config()
    ident_path = Path(cfg.get('identity') or DEFAULT_IDENTITY)
    pub = ensure_identity(ident_path)
    repo = Path(args.repo).resolve()
    repo.mkdir(parents=True, exist_ok=True)
    if not (repo / '.git').exists():
        subprocess.run(['git', 'init', '-q', '-b', 'main'], cwd=repo, check=True)
    tcfg_path = repo / TENANT_CONFIG_FILE
    tcfg = json.loads(tcfg_path.read_text(encoding='utf-8')) if tcfg_path.exists() else {'tenant': args.name, 'recipients': []}
    if pub not in tcfg['recipients']:
        tcfg['recipients'].append(pub)
    tcfg_path.write_text(json.dumps(tcfg, indent=2) + '\n', encoding='utf-8')
    (repo / '.gitattributes').write_text('* text=auto eol=lf\n*.age binary\n', encoding='utf-8')
    (repo / SNAPSHOT_DIR).mkdir(exist_ok=True)
    (repo / SNAPSHOT_DIR / '.gitkeep').touch()
    if not (repo / 'README.md').exists():
        (repo / 'README.md').write_text(README.format(name=args.name), encoding='utf-8')
    cfg.setdefault('tenants', {})[args.name] = {'repo': str(repo)}
    cfg['identity'] = str(ident_path)
    save_config(cfg)
    t = Tenant(args.name, repo, ident_path)
    if args.remote:
        if args.create_remote:
            log(f'Remote anlegen: {gitea_create_repo(args.remote)}')
        if not t.has_remote():
            t.git('remote', 'add', 'origin', args.remote)
    res = t.commit_push(f'{args.name}: tenant repo initialised')
    log(f'Mandant «{args.name}» in {repo} — Empfänger {pub} — {res}')
    log(f'Konfiguration: {CONFIG_PATH}')


def cmd_push(args):
    t = tenants_from(load_config()).get(args.name) or sys.exit(f'unbekannter Mandant: {args.name}')
    data = Path(args.file).read_bytes()
    if zipfile.is_zipfile(io.BytesIO(data)):
        log(json.dumps(t.store_export(data, f'manual push {Path(args.file).name}'), ensure_ascii=False))
    else:
        log(json.dumps(t.store_snapshot(Path(args.file).name, data, 'manual snapshot'), ensure_ascii=False))


def cmd_restore(args):
    t = tenants_from(load_config()).get(args.name) or sys.exit(f'unbekannter Mandant: {args.name}')
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    t.pull(force=True)
    data = t.export_bytes()
    if data is not None:
        (out / f'tenant-{t.name}.zip').write_bytes(data)
        log(f'tenant-{t.name}.zip ({len(data)} Bytes) — in die App ziehen')
    for p in sorted((t.repo / SNAPSHOT_DIR).glob('*.age')):
        (out / SNAPSHOT_DIR).mkdir(exist_ok=True)
        (out / SNAPSHOT_DIR / p.name[:-4]).write_bytes(t.decrypt_read(f'{SNAPSHOT_DIR}/{p.name}'))
    log(f'entschlüsselt nach {out}')


LIST_EXT = re.compile(r'\.(tsv|csv|txt)$', re.IGNORECASE)
APP_REGISTRY = Path(__file__).resolve().parent.parent / 'schema' / 'registry.json'


def snapshot_meta(data):
    """meta of an OrgGraph snapshot (same test as the app's looksLikeSnapshot), else None."""
    try:
        obj = json.loads(data.decode('utf-8'))
    except (UnicodeDecodeError, ValueError):
        return None
    meta = obj.get('meta') if isinstance(obj, dict) else None
    if not (isinstance(meta, dict) and meta.get('source') and meta.get('snapshot') and 'schema' in obj
            and isinstance(obj.get('nodes'), list) and isinstance(obj.get('edges'), list)):
        return None
    return {**meta, 'nodeCount': len(obj['nodes']), 'edgeCount': len(obj['edges'])}


def build_bundle(t, out, registry_path=APP_REGISTRY, with_lists=False):
    """Decrypt a tenant repo into numbered drop ZIPs for a from-scratch rebuild in the app.

    1-<tenant>-basis-<stamp>.zip   registry + env.<tenant>.json + the oldest snapshot
    N-<tenant>-<stamp>.zip         every further snapshot, oldest first (the app's
                                   chronology rejects older-after-newer)
    lists: only with with_lists, as a last ZIP — they open the intake dialog.
    Plain env name env.<tenant>.json sets the profile name. Re-runs replace earlier bundles.
    """
    out = Path(out)
    out.mkdir(parents=True, exist_ok=True)
    env_age = t.repo / f'env.{t.name}.json.age'
    env = t.decrypt_read(env_age.name) if env_age.exists() else None
    snapshots, lists, skipped = [], [], []
    snap_dir = t.repo / SNAPSHOT_DIR
    for p in sorted(snap_dir.glob('*.age')) if snap_dir.exists() else []:
        name, data = p.name[:-4], t.decrypt_read(f'{SNAPSHOT_DIR}/{p.name}')
        if LIST_EXT.search(name):
            lists.append((name, data))
            continue
        meta = snapshot_meta(data)
        if meta is None:
            skipped.append(name)
        else:
            snapshots.append((str(meta['snapshot']), name, data, meta))
    snapshots.sort(key=lambda s: (s[0], s[1]))
    if not snapshots:
        raise RuntimeError(f'{t.name}: kein Snapshot in {SNAPSHOT_DIR}/ – ohne Basisbestand gibt es nichts zu installieren')
    for old in out.glob(f'[0-9]*-{t.name}-*.zip'):
        old.unlink()

    def write_zip(fname, entries):
        with zipfile.ZipFile(out / fname, 'w', zipfile.ZIP_DEFLATED) as zf:
            for arc, data in entries:
                zf.writestr(arc, data)
        return fname

    produced = []
    stamp, name, data, meta = snapshots[0]
    entries = [('registry.json', Path(registry_path).read_bytes())]
    if env is not None:
        entries.append((f'env.{t.name}.json', env))
    entries.append((name, data))
    produced.append({'zip': write_zip(f'1-{t.name}-basis-{stamp}.zip', entries), 'snapshot': name, 'meta': meta})
    for i, (stamp, name, data, meta) in enumerate(snapshots[1:], start=2):
        produced.append({'zip': write_zip(f'{i}-{t.name}-{stamp}.zip', [(name, data)]), 'snapshot': name, 'meta': meta})
    if with_lists and lists:
        produced.append({'zip': write_zip(f'{len(produced) + 1}-{t.name}-listen.zip', lists), 'lists': [n for n, _ in lists]})
    return {'produced': produced, 'env': env is not None, 'lists': [n for n, _ in lists], 'skipped': skipped}


def cmd_bundle(args):
    t = tenants_from(load_config()).get(args.name) or sys.exit(f'unbekannter Mandant: {args.name}')
    t.pull(force=True)
    res = build_bundle(t, args.out, Path(args.registry) if args.registry else APP_REGISTRY, args.with_lists)
    out = Path(args.out).resolve()
    print(f'\nDrop-Pakete für «{t.name}» in {out}, in dieser Reihenfolge in eine frische App ziehen,')
    print('jeweils erst nach Abschluss des vorherigen Imports:\n')
    for p in res['produced']:
        if 'meta' in p:
            m = p['meta']
            print(f'  {p["zip"]:<48} {m["source"]} {m["snapshot"]}  {m["nodeCount"]} Knoten, {m["edgeCount"]} Kanten')
        else:
            print(f'  {p["zip"]:<48} {len(p["lists"])} Listen (Intake-Dialog je Liste)')
    if not res['env']:
        print(f'\n  Hinweis: kein env.{t.name}.json.age im Repo – Paket 1 ohne Sichten, Profilname aus der Registry.')
    if res['lists'] and not args.with_lists:
        print(f'\n  {len(res["lists"])} Listen nicht gebündelt (laufen über den Intake-Dialog; mit --with-lists als letztes Paket).')
    if res['skipped']:
        print(f'\n  Weder Snapshot noch Liste, ausgelassen: {", ".join(res["skipped"])}')
    print('\n  Die Pakete sind unverschlüsselt und enthalten Personendaten: nach dem Import löschen.')


def cmd_status(args):
    cfg = load_config()
    tenants = tenants_from(cfg)
    for name, t in tenants.items():
        if args.name and name != args.name:
            continue
        print(json.dumps(t.status(), indent=2, ensure_ascii=False))


def cmd_keygen(args):
    cfg = load_config()
    path = Path(cfg.get('identity') or DEFAULT_IDENTITY)
    pub = ensure_identity(path)
    cfg['identity'] = str(path)
    save_config(cfg)
    log(f'Identität {path} — öffentlicher Schlüssel: {pub}')


def cmd_selftest(args):
    """Round trip in a temporary tenant without remote: init, export, snapshot, restore."""
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        ident = tmp / 'id.txt'
        pub = ensure_identity(ident)
        repo = tmp / 'tenant-test'
        repo.mkdir()
        subprocess.run(['git', 'init', '-q', '-b', 'main'], cwd=repo, check=True)
        subprocess.run(['git', 'config', 'user.email', 'hub@test'], cwd=repo, check=True)
        subprocess.run(['git', 'config', 'user.name', 'hub'], cwd=repo, check=True)
        (repo / TENANT_CONFIG_FILE).write_text(json.dumps({'tenant': 'test', 'recipients': [pub]}), encoding='utf-8')
        t = Tenant('test', repo, ident)
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as zf:
            zf.writestr('manifest.json', json.dumps({'format': 'orggraph-tenant-2', 'exportedAt': '2026-09-16T12:00:00Z', 'counts': {'nodes': 3}}))
            zf.writestr('store.json', '{"nodes":[]}')
        r1 = t.store_export(buf.getvalue(), 'selftest')
        assert r1['git']['committed'] and r1['counts']['nodes'] == 3, r1
        assert t.export_bytes() == buf.getvalue(), 'export roundtrip'
        r2 = t.store_snapshot('crawl ../x/y.json', b'{"meta":{}}')
        assert r2['stored'] == 'snapshots/y.json.age' and (repo / r2['stored']).exists(), r2  # path parts are dropped
        assert t.decrypt_read(r2['stored']) == b'{"meta":{}}'
        r3 = t.store_export(buf.getvalue(), 'unchanged')
        assert r3['git']['committed'] is True  # manifest storedAt changes → a commit per push is intended
        assert t.manifest()['reason'] == 'unchanged'
        commits = t.git('rev-list', '--count', 'HEAD').stdout.strip()
        assert commits == '3', commits
        try:
            t.store_export(b'not a zip', 'bad')
            raise AssertionError('bad zip accepted')
        except RuntimeError:
            pass
        assert t.pull(force=True)['reason'] == 'no remote'
        snap = lambda stamp: json.dumps({'meta': {'source': 's', 'snapshot': stamp}, 'schema': {}, 'nodes': [], 'edges': []}).encode()
        t.encrypt_write(f'{SNAPSHOT_DIR}/late.json.age', snap('20260916-1143'))
        t.encrypt_write(f'{SNAPSHOT_DIR}/base.json.age', snap('20260612-0000'))
        t.encrypt_write(f'{SNAPSHOT_DIR}/list.tsv.age', b'a\tb\n')
        t.encrypt_write('env.test.json.age', b'{"VIEWS":{}}')
        b = build_bundle(t, tmp / 'drop')
        assert [p['zip'] for p in b['produced']] == ['1-test-basis-20260612-0000.zip', '2-test-20260916-1143.zip'], b
        with zipfile.ZipFile(tmp / 'drop' / b['produced'][0]['zip']) as zf:
            assert sorted(zf.namelist()) == ['base.json', 'env.test.json', 'registry.json'], zf.namelist()
        assert b['lists'] == ['list.tsv'] and b['skipped'] == ['y.json'], b
        b2 = build_bundle(t, tmp / 'drop', with_lists=True)
        assert b2['produced'][-1]['zip'] == '3-test-listen.zip' and len(list((tmp / 'drop').glob('*.zip'))) == 3, b2
        print(f'selftest ok — {commits} commits, snapshot {r2["stored"]}, status {json.dumps(t.status()["manifest"]["reason"])}')


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    sub = ap.add_subparsers(dest='cmd', required=True)
    p = sub.add_parser('init', help='tenant repo anlegen/registrieren')
    p.add_argument('name')
    p.add_argument('--repo', required=True)
    p.add_argument('--remote')
    p.add_argument('--create-remote', action='store_true', help='Remote über die Gitea-API anlegen (Zugangsdaten aus git credential)')
    p.set_defaults(fn=cmd_init)
    p = sub.add_parser('push', help='Tenant-ZIP oder Rohdatei manuell einspielen')
    p.add_argument('name')
    p.add_argument('file')
    p.set_defaults(fn=cmd_push)
    p = sub.add_parser('restore', help='letzten Export und Rohdateien entschlüsseln')
    p.add_argument('name')
    p.add_argument('--out', required=True)
    p.set_defaults(fn=cmd_restore)
    p = sub.add_parser('bundle', help='Drop-Pakete für einen Neuaufbau in der App erzeugen')
    p.add_argument('name')
    p.add_argument('--out', required=True)
    p.add_argument('--registry', help=f'Registry statt {APP_REGISTRY.relative_to(APP_REGISTRY.parent.parent)}')
    p.add_argument('--with-lists', action='store_true', help='Identifikator-Listen als letztes Paket mitgeben')
    p.set_defaults(fn=cmd_bundle)
    p = sub.add_parser('status', help='Stand der Mandanten')
    p.add_argument('name', nargs='?')
    p.set_defaults(fn=cmd_status)
    p = sub.add_parser('keygen', help='age-Identität anlegen')
    p.set_defaults(fn=cmd_keygen)
    p = sub.add_parser('selftest', help='Rundlauf in einem temporären Repo')
    p.set_defaults(fn=cmd_selftest)
    args = ap.parse_args(argv)
    args.fn(args)


if __name__ == '__main__':
    main()
