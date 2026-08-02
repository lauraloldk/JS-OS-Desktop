PLUGIN_ID = 'smartdialog'
PLUGIN_NAME = 'Smart Dialog Bridge'
PLUGIN_VERSION = '1.0.0'
PLUGIN_REQUIRED = False
PLUGIN_DEFAULT_ENABLED = True


def get_ui_extensions(target, payload, context):
    if target != 'smartdialog.interceptor':
        return []

    app_id = str((payload or {}).get('appId') or '').strip().lower()
    if app_id in ('', 'desktop', 'settings', 'settings.plugin-manager'):
        return []

    return [
        {
            'id': 'smartdialog.intercept',
            'kind': 'bridge-config',
            'enabled': True,
            'label': 'Smart Dialog Interceptor'
        }
    ]
