window.createWindow = function(title, url) {
    const canvas = document.getElementById('canvas');
    const windowDiv = document.createElement('div');
    windowDiv.classList.add('window');
    windowDiv.dataset.windowTitle = title;
    windowDiv.dataset.windowUrl = url;
    windowDiv.innerHTML = `
        <div class="window-header">
            <span class="window-title">${title}</span>
            <div class="window-controls">
                <button class="add-shortcut" title="Add to desktop">Add Shortcut</button>
                <button class="help" title="Help">?</button>
                <button class="window-close" title="Close">X</button>
            </div>
        </div>
        <iframe class="window-content" src="${url}"></iframe>
    `;

    // Add drag event to window header
    const windowHeader = windowDiv.querySelector('.window-header');
    let initialMouseX, initialMouseY, initialWindowX, initialWindowY;

    windowHeader.addEventListener('mousedown', function(event) {
        // Don't drag if clicking on buttons
        if (event.target.tagName === 'BUTTON') {
            return;
        }
        
        initialMouseX = event.clientX;
        initialMouseY = event.clientY;
        const windowRect = windowDiv.getBoundingClientRect();
        initialWindowX = windowRect.left;
        initialWindowY = windowRect.top;

        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', handleMouseUp);
        
        // Prevent text selection while dragging
        event.preventDefault();
    });

    function handleMouseMove(event) {
        const deltaX = event.clientX - initialMouseX;
        const deltaY = event.clientY - initialMouseY;
        const newWindowX = initialWindowX + deltaX;
        const newWindowY = initialWindowY + deltaY;
        windowDiv.style.left = newWindowX + 'px';
        windowDiv.style.top = newWindowY + 'px';
    }

    function handleMouseUp() {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
    }

    // Add click event to window close button
    const windowCloseButton = windowDiv.querySelector('.window-close');
    windowCloseButton.addEventListener('click', function() {
        canvas.removeChild(windowDiv);
    });

    const shortcutButton = windowDiv.querySelector('.add-shortcut');
    const shortcutTarget = {
        title: title,
        url: url,
        type: url.startsWith('apps/') ? 'app' : 'file'
    };

    if (window.JSOSShortcuts && typeof window.JSOSShortcuts.syncButtonState === 'function') {
        window.JSOSShortcuts.syncButtonState(shortcutButton, shortcutTarget);
    }

    shortcutButton.addEventListener('click', async function() {
        if (!window.JSOSShortcuts || typeof window.JSOSShortcuts.toggleShortcutForTarget !== 'function') {
            alert('Shortcut system is not loaded yet.');
            return;
        }

        try {
            await window.JSOSShortcuts.toggleShortcutForTarget(shortcutTarget);
            window.JSOSShortcuts.syncButtonState(shortcutButton, shortcutTarget);
        } catch (error) {
            console.error('Failed to toggle shortcut:', error);
            alert('Could not update shortcut.');
        }
    });
    
    // hide help button if there is no help.html file in the same directory as the file using the "url" parameter
    


    const helpButton = windowDiv.querySelector('.help');
    helpButton.addEventListener('click', function() {
        const helpUrl = url.replace(/\/[^/]*$/, '/help.html');
        createWindow('Help', helpUrl);
    });

    // Change background color of iframe to white
    const windowContent = windowDiv.querySelector('.window-content');
    windowContent.style.backgroundColor = 'grey';

    canvas.appendChild(windowDiv);
}

