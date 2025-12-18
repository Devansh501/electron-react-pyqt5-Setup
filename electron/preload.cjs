const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
    // React calls this to send a command
    sendJob: (command) => ipcRenderer.invoke('send-command', command),

    // React calls this to listen for updates
    onUpdate: (callback) => {
        const subscription = (_event, value) => callback(value);
        ipcRenderer.on('zmq-update', subscription);
        
        // Return a cleanup function to remove listener
        return () => ipcRenderer.removeListener('zmq-update', subscription);
    }
});
