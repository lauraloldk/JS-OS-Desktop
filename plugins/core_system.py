PLUGIN_ID = 'core_system'
PLUGIN_NAME = 'Core System Plugin'
PLUGIN_VERSION = '1.0.0'
PLUGIN_REQUIRED = True
PLUGIN_DEFAULT_ENABLED = True


def get_ui_extensions(target, payload, context):
    if target == 'toolbar.inject':
        return [
            {
                'kind': 'toolbar-button',
                'id': 'core.plugins_actions',
                'label': 'Plugin Actions'
            }
        ]

    return []
