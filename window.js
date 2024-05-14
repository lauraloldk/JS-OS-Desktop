window.createWindow = function(title, url) {
    const canvas = document.getElementById('canvas');
    const windowDiv = document.createElement('div');
    windowDiv.classList.add('window');
    windowDiv.innerHTML = `
        <div class="window-header">
            <span class="window-title">${title}</span>
            <button class="window-close">X</button>
            <button class="help">help</button>
        </div>
        <iframe class="window-content" src="${url}"></iframe>
        
    `;

    // Add drag event to window title
    const windowTitle = windowDiv.querySelector('.window-title');
    let initialMouseX, initialMouseY, initialWindowX, initialWindowY;

    windowTitle.addEventListener('mousedown', function(event) {
        initialMouseX = event.clientX;
        initialMouseY = event.clientY;
        const windowRect = windowDiv.getBoundingClientRect();
        initialWindowX = windowRect.left;
        initialWindowY = windowRect.top;

        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', handleMouseUp);
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

