PLUGIN_ID = 'taskmanager'
PLUGIN_NAME = 'Task Manager Integration'
PLUGIN_VERSION = '1.0.0'
PLUGIN_REQUIRED = False
PLUGIN_DEFAULT_ENABLED = False
PLUGIN_DEPENDS_OPTIONAL = ['zip']


def get_ui_extensions(target, payload, context):
    if target in ('desktop', 'jsexplorer.toolbar', 'dialogs.file'):
        return [
            {
                'kind': 'open-app',
                'id': 'taskmanager.open',
                'label': 'Task Manager',
                'appUrl': 'apps/taskmanager/index.html'
            }
        ]

    return []
