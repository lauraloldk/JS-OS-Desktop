PLUGIN_ID = 'quicknotes'
PLUGIN_NAME = 'Quick Notes Integration'
PLUGIN_VERSION = '1.0.0'
PLUGIN_REQUIRED = False
PLUGIN_DEFAULT_ENABLED = False
PLUGIN_DEPENDS_OPTIONAL = ['notepad_tools']


def get_ui_extensions(target, payload, context):
    if target in ('notepad.plugin-menu', 'jsexplorer.plugin-menu'):
        return [
            {
                'kind': 'open-app',
                'id': 'quicknotes.open',
                'label': 'Open Quick Notes',
                'appUrl': 'apps/quicknotes/index.html'
            }
        ]

    return []
