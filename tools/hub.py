#!/usr/bin/env python3
"""OrgGraph tenant hub (E77): one private git repo per tenant, age-encrypted.

The single-file app cannot run git. This local hub does what the PMO does for
its tasks: every change is committed and pushed, every reload pulls first.

  python tools/hub.py keygen                       # age identity (once per machine)
  python tools/hub.py init sem --repo <dir> [--remote <url>] [--create-remote]
  python tools/hub.py serve [--port 8644]          # http://127.0.0.1:8644/t/sem/
  python tools/hub.py push sem <file>              # manual: tenant ZIP or raw snapshot
  python tools/hub.py restore sem --out <dir>      # decrypt the latest tenant ZIP + snapshots
  python tools/hub.py status sem
  python tools/hub.py selftest

Tenant repo layout:
  config.json        tenant name + age recipients (plain)
  manifest.json      what the latest export is (plain, diffable)
  tenant.zip.age     the app's tenant export (registry, env, store, manifest)
  snapshots/*.age    raw inputs the app received (crawl exports, lists)

HTTP (served for the app; CORS open, bound to 127.0.0.1):
  GET  /t/<tenant>/                      the app (index.html of the configured app root)
  GET  /api/hub                          { tenants, version }
  GET  /api/tenants/<t>/manifest         pulls first (throttled), then the manifest
  GET  /api/tenants/<t>/export           the decrypted tenant ZIP
  PUT  /api/tenants/<t>/export?reason=…  store a new tenant ZIP: encrypt, commit, push
  POST /api/tenants/<t>/snapshots/<name> archive a raw input: encrypt, commit, push

Config: ~/.config/orggraph/hub.json (override: ORGGRAPH_HUB_CONFIG)
  { "identity": "<age key file>", "app": "<app repo root>", "port": 8644,
    "tenants": { "sem": { "repo": "<tenant repo dir>" } } }
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
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse
from urllib.request import Request, urlopen

HUB_VERSION = 'hub-1'
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
    return {'identity': str(DEFAULT_IDENTITY), 'app': None, 'port': 8644, 'tenants': {}}


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
            manifest = {**inner, 'tenant': self.name, 'storedAt': now_iso(), 'reason': reason, 'bytes': len(zip_bytes), 'hub': HUB_VERSION}
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

Pflege ausschliesslich über `tools/hub.py` des App-Repos: `serve` bedient die App (Pull bei jedem Laden, Commit und Push bei
jeder Änderung), `push` und `restore` sind der manuelle Weg. Entschlüsseln kann nur, wer eine Identität zu einem der Empfänger hat.
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
    if args.app:
        cfg['app'] = str(Path(args.app).resolve())
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


# ---- HTTP -----------------------------------------------------------------------
class HubHandler(BaseHTTPRequestHandler):
    server_version = f'OrgGraphHub/{HUB_VERSION}'
    hub = None  # set by serve()

    def log_message(self, fmt, *args):  # quieter default log
        log(f'{self.address_string()} {fmt % args}')

    def _cors(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, PUT, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')

    def _json(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode('utf-8')
        self.send_response(code)
        self._cors()
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(body)

    def _bytes(self, code, data, ctype):
        self.send_response(code)
        self._cors()
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(data)

    def _body(self):
        n = int(self.headers.get('Content-Length') or 0)
        return self.rfile.read(n) if n else b''

    def _tenant(self, name):
        t = self.hub['tenants'].get(unquote(name))
        if not t:
            self._json(404, {'error': f'unbekannter Mandant: {name}'})
        return t

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self):
        u = urlparse(self.path)
        path = u.path
        m = re.fullmatch(r'/api/tenants/([^/]+)/(manifest|export)', path)
        try:
            if path == '/api/hub':
                return self._json(200, {'version': HUB_VERSION, 'tenants': sorted(self.hub['tenants'].keys()), 'app': self.hub['app'] is not None})
            if m:
                t = self._tenant(m.group(1))
                if not t:
                    return None
                if m.group(2) == 'manifest':
                    pulled = t.pull(force='force' in parse_qs(u.query))
                    return self._json(200, {'tenant': t.name, 'manifest': t.manifest(), 'pull': pulled})
                data = t.export_bytes()
                if data is None:
                    return self._json(404, {'error': 'noch kein Export im Repo'})
                return self._bytes(200, data, 'application/zip')
            # the app: /t/<tenant>/ (any tenant path serves the same single file)
            if self.hub['app'] and (path in ('/', '/index.html') or re.fullmatch(r'/t/[^/]+/(index\.html)?', path)):
                return self._bytes(200, Path(self.hub['app']).read_bytes(), 'text/html; charset=utf-8')
            return self._json(404, {'error': 'not found'})
        except Exception as err:  # noqa: BLE001
            log(f'GET {path}: {err}')
            return self._json(500, {'error': str(err)})

    def do_PUT(self):
        u = urlparse(self.path)
        m = re.fullmatch(r'/api/tenants/([^/]+)/export', u.path)
        if not m:
            return self._json(404, {'error': 'not found'})
        t = self._tenant(m.group(1))
        if not t:
            return None
        reason = (parse_qs(u.query).get('reason') or ['export'])[0][:120]
        try:
            return self._json(200, t.store_export(self._body(), reason))
        except Exception as err:  # noqa: BLE001
            log(f'PUT export {t.name}: {err}')
            return self._json(400, {'error': str(err)})

    def do_POST(self):
        u = urlparse(self.path)
        m = re.fullmatch(r'/api/tenants/([^/]+)/snapshots/([^/]+)', u.path)
        if not m:
            return self._json(404, {'error': 'not found'})
        t = self._tenant(m.group(1))
        if not t:
            return None
        try:
            return self._json(200, t.store_snapshot(unquote(m.group(2)), self._body()))
        except Exception as err:  # noqa: BLE001
            log(f'POST snapshot {t.name}: {err}')
            return self._json(400, {'error': str(err)})


def cmd_serve(args):
    cfg = load_config()
    tenants = tenants_from(cfg)
    if not tenants:
        sys.exit('keine Mandanten konfiguriert — zuerst: hub.py init <name> --repo <dir>')
    app = cfg.get('app')
    app_file = Path(app) / 'index.html' if app else None
    if app_file and not app_file.exists():
        log(f'App nicht gefunden: {app_file} — nur API')
        app_file = None
    for t in tenants.values():
        log(f'{t.name}: {t.repo} — pull: {t.pull(force=True)}')
    HubHandler.hub = {'tenants': tenants, 'app': str(app_file) if app_file else None}
    port = args.port or cfg.get('port') or 8644
    srv = ThreadingHTTPServer(('127.0.0.1', port), HubHandler)
    for name in tenants:
        log(f'http://127.0.0.1:{port}/t/{name}/')
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        log('beendet')


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
        print(f'selftest ok — {commits} commits, snapshot {r2["stored"]}, status {json.dumps(t.status()["manifest"]["reason"])}')


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    sub = ap.add_subparsers(dest='cmd', required=True)
    p = sub.add_parser('init', help='tenant repo anlegen/registrieren')
    p.add_argument('name')
    p.add_argument('--repo', required=True)
    p.add_argument('--remote')
    p.add_argument('--create-remote', action='store_true', help='Remote über die Gitea-API anlegen (Zugangsdaten aus git credential)')
    p.add_argument('--app', help='App-Repo-Wurzel (index.html), das serve ausliefert')
    p.set_defaults(fn=cmd_init)
    p = sub.add_parser('serve', help='Hub für die App starten')
    p.add_argument('--port', type=int)
    p.set_defaults(fn=cmd_serve)
    p = sub.add_parser('push', help='Tenant-ZIP oder Rohdatei manuell einspielen')
    p.add_argument('name')
    p.add_argument('file')
    p.set_defaults(fn=cmd_push)
    p = sub.add_parser('restore', help='letzten Export und Rohdateien entschlüsseln')
    p.add_argument('name')
    p.add_argument('--out', required=True)
    p.set_defaults(fn=cmd_restore)
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
