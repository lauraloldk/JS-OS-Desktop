    // Load the JSON file
    fetch('data/os-settings.json')
      .then(response => response.json())
      .then(data => {
        // Extract the value of "taskbarcolor"
        const taskbarColor = data.taskbarcolor;

        // Select the "taskbar" div
        const taskbarDiv = document.getElementById('taskbar');

        // Set the background color of the "taskbar" div
        taskbarDiv.style.backgroundColor = taskbarColor;
      })
      .catch(error => {
        console.error('Error:', error);
      });