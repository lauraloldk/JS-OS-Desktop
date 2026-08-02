import json
import os
import re
import shutil
import tempfile
import time
import urllib.parse
import urllib.request
import zipfile

PLUGIN_ID = 'webapphub'
PLUGIN_NAME = 'WebApp Hub'
PLUGIN_VERSION = '1.0.0'
PLUGIN_REQUIRED = False
PLUGIN_DEFAULT_ENABLED = False
PLUGIN_DEPENDS_OPTIONAL = ['devtools']

_ALLOWED_RATINGS = {
    'working',
    'something works',
    'not working at all'
}


def _json_read(path, fallback):
    if not os.path.isfile(path):
        return fallback

    try:
        with open(path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        return data
    except Exception:
        return fallback


def _json_write(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


def _slugify_repo(full_name):
    text = str(full_name or '').strip().lower()
    text = text.replace('\\', '/').strip('/')
    text = re.sub(r'[^a-z0-9._/-]+', '-', text)
    text = text.replace('/', '-')
    text = re.sub(r'-{2,}', '-', text).strip('-')
    if not text:
        raise ValueError('Invalid repository name')
    return text


def _js_escape(text):
    value = str(text or '')
    return value.replace('\\', '\\\\').replace("'", "\\'")


def _request_json(url):
    request = urllib.request.Request(
        url,
        headers={
            'Accept': 'application/vnd.github+json',
            'User-Agent': 'JS-OS-WebAppHub'
        }
    )
    with urllib.request.urlopen(request, timeout=25) as response:
        body = response.read().decode('utf-8')
    return json.loads(body)


def _download_bytes(url):
    request = urllib.request.Request(
        url,
        headers={'User-Agent': 'JS-OS-WebAppHub'}
    )
    with urllib.request.urlopen(request, timeout=45) as response:
        return response.read()


def _pick_repo_root(extract_dir):
    entries = [
        os.path.join(extract_dir, name)
        for name in os.listdir(extract_dir)
    ]
    dirs = [path for path in entries if os.path.isdir(path)]
    if len(dirs) == 1:
        return dirs[0]
    return extract_dir


def _find_index_relative(source_root, html_path=''):
    requested = str(html_path or '').replace('\\', '/').strip('/').strip()
    if requested:
        requested_abs = os.path.abspath(os.path.join(source_root, requested))
        root_abs = os.path.abspath(source_root)
        if requested_abs != root_abs and not requested_abs.startswith(root_abs + os.sep):
            raise ValueError('htmlPath escapes repository root')
        if not os.path.isfile(requested_abs):
            raise FileNotFoundError(f'htmlPath not found: {requested}')
        return requested.replace('\\', '/')

    candidates = [
        'index.html',
        'docs/index.html',
        'public/index.html',
        'dist/index.html',
        'build/index.html',
        'src/index.html'
    ]

    for rel in candidates:
        if os.path.isfile(os.path.join(source_root, rel)):
            return rel

    first_found = ''
    for dirpath, dirnames, filenames in os.walk(source_root):
        dirnames[:] = [name for name in dirnames if name != '__pycache__']
        for filename in filenames:
            if filename.lower() != 'index.html':
                continue
            abs_path = os.path.join(dirpath, filename)
            first_found = os.path.relpath(abs_path, source_root).replace(os.sep, '/')
            break
        if first_found:
            break

    if not first_found:
        raise FileNotFoundError('No index.html found in repository archive')

    return first_found


def _devtools_enabled(base_dir):
    registry_path = os.path.join(base_dir, 'data', 'plugins.json')
    registry = _json_read(registry_path, {})
    plugins = registry.get('plugins', {}) if isinstance(registry, dict) else {}
    devtools_item = plugins.get('devtools', {}) if isinstance(plugins, dict) else {}
    return bool(devtools_item.get('enabled')) if isinstance(devtools_item, dict) else False


def _installed_path(base_dir):
    return os.path.join(base_dir, 'data', 'webapphub-installed.json')


def _ratings_path(base_dir):
    return os.path.join(base_dir, 'data', 'webapphub-ratings.json')


def _read_installed(base_dir):
    data = _json_read(_installed_path(base_dir), {'apps': {}})
    if not isinstance(data, dict):
        data = {'apps': {}}
    if not isinstance(data.get('apps'), dict):
        data['apps'] = {}
    return data


def _read_ratings(base_dir):
    data = _json_read(_ratings_path(base_dir), {'ratings': {}})
    if not isinstance(data, dict):
        data = {'ratings': {}}
    if not isinstance(data.get('ratings'), dict):
        data['ratings'] = {}
    return data


def _search_repositories(payload):
    query = str((payload or {}).get('query') or '').strip()
    page = int((payload or {}).get('page') or 1)
    page = max(1, min(page, 10))

    if query:
        github_query = f'{query} in:name,description,readme topic:webapp archived:false'
    else:
        github_query = 'topic:webapp archived:false'

    url = (
        'https://api.github.com/search/repositories?'
        + urllib.parse.urlencode({
            'q': github_query,
            'sort': 'stars',
            'order': 'desc',
            'per_page': 20,
            'page': page
        })
    )

    data = _request_json(url)
    items = data.get('items', []) if isinstance(data, dict) else []

    results = []
    for item in items:
        if not isinstance(item, dict):
            continue

        owner = item.get('owner', {}) if isinstance(item.get('owner'), dict) else {}
        results.append({
            'id': item.get('id'),
            'fullName': str(item.get('full_name') or ''),
            'name': str(item.get('name') or ''),
            'owner': str(owner.get('login') or ''),
            'description': str(item.get('description') or ''),
            'stars': int(item.get('stargazers_count') or 0),
            'url': str(item.get('html_url') or ''),
            'defaultBranch': str(item.get('default_branch') or 'main')
        })

    return {
        'items': results,
        'totalCount': int(data.get('total_count') or 0),
        'page': page
    }


def _install_repository(payload, context):
    base_dir = context['base_dir']

    full_name = str((payload or {}).get('fullName') or '').strip()
    if not full_name or '/' not in full_name:
        raise ValueError('fullName must be in format owner/repo')

    branch = str((payload or {}).get('branch') or '').strip() or 'main'
    html_path = str((payload or {}).get('htmlPath') or '').strip()

    slug = _slugify_repo(full_name)
    target_app_dir = os.path.join(base_dir, 'apps', 'webapps', slug)
    target_bundle_dir = os.path.join(target_app_dir, 'bundle')

    zip_url = f'https://api.github.com/repos/{full_name}/zipball/{urllib.parse.quote(branch)}'
    zip_bytes = _download_bytes(zip_url)

    with tempfile.TemporaryDirectory(prefix='webapphub_') as temp_dir:
        archive_path = os.path.join(temp_dir, 'repo.zip')
        with open(archive_path, 'wb') as f:
            f.write(zip_bytes)

        extract_dir = os.path.join(temp_dir, 'extract')
        os.makedirs(extract_dir, exist_ok=True)

        with zipfile.ZipFile(archive_path, 'r') as zf:
            zf.extractall(extract_dir)

        source_root = _pick_repo_root(extract_dir)
        entry_rel = _find_index_relative(source_root, html_path)

        if os.path.isdir(target_app_dir):
            shutil.rmtree(target_app_dir)

        os.makedirs(target_bundle_dir, exist_ok=True)
        for name in os.listdir(source_root):
            src = os.path.join(source_root, name)
            dst = os.path.join(target_bundle_dir, name)
            if os.path.isdir(src):
                shutil.copytree(src, dst, dirs_exist_ok=True)
            else:
                shutil.copy2(src, dst)

    app_title = str((payload or {}).get('title') or '').strip() or full_name.split('/')[-1]

    launcher_html = f"""<!DOCTYPE html>
<html>
<head>
    <title>{app_title}</title>
    <script>
        const start_titel = '{_js_escape(app_title)}';
    </script>
    <style>
        html, body {{ margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; }}
        iframe {{ border: 0; width: 100%; height: 100%; }}
    </style>
</head>
<body>
    <iframe src="bundle/{entry_rel}"></iframe>
</body>
</html>
"""

    with open(os.path.join(target_app_dir, 'index.html'), 'w', encoding='utf-8') as f:
        f.write(launcher_html)

    installed = _read_installed(base_dir)
    installed['apps'][slug] = {
        'slug': slug,
        'fullName': full_name,
        'branch': branch,
        'entry': entry_rel,
        'title': app_title,
        'appUrl': f'apps/webapps/{slug}/index.html',
        'installedAt': int(time.time())
    }
    _json_write(_installed_path(base_dir), installed)

    return {
        'slug': slug,
        'fullName': full_name,
        'title': app_title,
        'appUrl': f'apps/webapps/{slug}/index.html'
    }


def _list_installed(payload, context):
    base_dir = context['base_dir']
    installed = _read_installed(base_dir)
    ratings = _read_ratings(base_dir)
    can_rate = _devtools_enabled(base_dir)

    apps = []
    for slug in sorted(installed['apps'].keys()):
        item = installed['apps'][slug]
        if not isinstance(item, dict):
            continue

        full_name = str(item.get('fullName') or '')
        rating = ratings['ratings'].get(full_name, {}) if full_name else {}

        apps.append({
            **item,
            'rating': rating if isinstance(rating, dict) else {}
        })

    return {
        'apps': apps,
        'canRate': can_rate,
        'allowedRatings': sorted(_ALLOWED_RATINGS)
    }


def _set_rating(payload, context):
    base_dir = context['base_dir']
    if not _devtools_enabled(base_dir):
        raise ValueError('Devtools plugin must be enabled to rate apps')

    full_name = str((payload or {}).get('fullName') or '').strip()
    if not full_name:
        raise ValueError('fullName is required')

    status = str((payload or {}).get('status') or '').strip().lower()
    if status not in _ALLOWED_RATINGS:
        raise ValueError('Invalid status')

    note = str((payload or {}).get('note') or '').strip()

    ratings = _read_ratings(base_dir)
    ratings['ratings'][full_name] = {
        'status': status,
        'note': note,
        'updatedAt': int(time.time())
    }
    _json_write(_ratings_path(base_dir), ratings)

    return {
        'fullName': full_name,
        'status': status
    }


def get_ui_extensions(target, payload, context):
    if target in ('toolbar.inject', 'jsexplorer.plugin-menu', 'notepad.plugin-menu'):
        return [
            {
                'kind': 'open-app',
                'id': 'webapphub.open',
                'label': 'WebApp Hub',
                'appUrl': 'apps/webapphub/index.html'
            }
        ]

    return []


def execute_plugin_action(action_id, payload, context):
    if action_id == 'webapphub.search':
        return _search_repositories(payload)

    if action_id == 'webapphub.install':
        result = _install_repository(payload, context)
        return {
            'message': f"Installed {result['fullName']} as {result['title']}",
            **result
        }

    if action_id == 'webapphub.list':
        return _list_installed(payload, context)

    if action_id == 'webapphub.rate':
        result = _set_rating(payload, context)
        return {
            'message': f"Saved rating for {result['fullName']}",
            **result
        }

    return None
