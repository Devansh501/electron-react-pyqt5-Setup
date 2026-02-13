const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const { spawn } = require("child_process");
const zmq = require("zeromq");

// --- Global Variables ---
let mainWindow;
let pythonProcess;

// ZeroMQ Sockets
const sockReq = new zmq.Request(); // For sending Commands (REQ)
const sockSub = new zmq.Subscriber(); // For listening to Updates (SUB)

// --- 1. ZeroMQ Setup Function ---
async function setupZMQ() {
  try {
    // Connect to the Python ports
    // Note: These ports must match backend.py
    sockReq.connect("tcp://127.0.0.1:5555");
    sockSub.connect("tcp://127.0.0.1:5556");

    // Subscribe to all topics (or specific ones like "progress", "result")
    sockSub.subscribe("progress");
    sockSub.subscribe("result");

    console.log("[Electron] Connected to Python ZMQ Sockets.");

    // Start listening for incoming messages (Async Iterator)
    // This loop runs forever in the background
    for await (const [msg] of sockSub) {
      const message = msg.toString();

      // Forward the message to React immediately
      if (mainWindow) {
        mainWindow.webContents.send("zmq-update", message);
      }
    }
  } catch (err) {
    console.error("[Electron] ZeroMQ Error:", err);
  }
}

// --- 2. Window Creation ---
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 700,
    webPreferences: {
      nodeIntegration: false, // Security: Keep Node out of Renderer
      contextIsolation: true, // Security: Use Preload Bridge
      preload: path.join(__dirname, "preload.cjs"), // The secure bridge
    },
  });

  // Determine Start URL
  // In Dev: Wait for Vite server (handled by 'concurrently' in package.json)
  // In Prod: Load the built index.html
  const startUrl =
    process.env.ELECTRON_START_URL ||
    `file://${path.join(__dirname, "../dist/index.html")}`;

  mainWindow.loadURL(startUrl);

  // Optional: Open DevTools in development mode
  // mainWindow.webContents.openDevTools();

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

// --- 3. IPC Handlers (React -> Electron) ---
// When React calls 'sendJob', this runs:
ipcMain.handle("send-command", async (event, command) => {
  console.log(`[Electron] Sending command to Python: ${command}`);

  try {
    // Send to Python
    await sockReq.send(command);

    // Wait for immediate acknowledgement (The "ID" response)
    const [reply] = await sockReq.receive();
    return reply.toString();
  } catch (err) {
    console.error("ZMQ Send Error:", err);
    return JSON.stringify({ error: "Failed to reach backend" });
  }
});

// --- 4. Python Process Management ---
function startPythonBackend() {
  // Path to backend.py
  // Goes up one level from 'electron' folder, then into 'py_backend'
  const scriptPath = path.join(__dirname, "..", "py_backend", "backend.py");

  // Determine command based on OS
  const pythonCmd = process.platform === "win32" ? "python" : "python3";

  console.log(`[Electron] Launching Python from: ${scriptPath}`);

  // Spawn the process
  pythonProcess = spawn(pythonCmd, [scriptPath]);

  // Pipe Python prints to Electron console (Helpful for debugging)
  pythonProcess.stdout.on("data", (data) => {
    console.log(`[Python]: ${data}`);
  });

  pythonProcess.stderr.on("data", (data) => {
    console.error(`[Python Err]: ${data}`);
  });

  pythonProcess.on("close", (code) => {
    console.log(`[Python] Process exited with code ${code}`);
  });
}

function startBackend() {
  let scriptPath;
  let cmd;
  let args;

  if (app.isPackaged) {
    // --- PRODUCTION MODE ---
    // 1. We are running the compiled binary, NOT python3.
    // 2. The binary is located in the 'resources' folder, outside app.asar.
    // 3. On Linux, the file has no extension (just 'backend').

    const executableName =
      process.platform === "win32" ? "backend.exe" : "backend";

    // process.resourcesPath points to the folder where 'extraResources' are copied
    scriptPath = path.join(process.resourcesPath, executableName);

    console.log(`[Prod] Launching Python executable from: ${scriptPath}`);

    cmd = scriptPath;
    args = []; // No arguments needed, the executable runs itself
  } else {
    // --- DEVELOPMENT MODE ---
    // Here we still use the raw script
    scriptPath = path.join(__dirname, "..", "py_backend", "backend.py");
    console.log(`[Dev] Launching Python script from: ${scriptPath}`);

    cmd = process.platform === "win32" ? "python" : "python3";
    args = [scriptPath];
  }

  // Spawn the process
  pythonProcess = spawn(cmd, args);

  pythonProcess.stdout.on("data", (d) => console.log(`[PY]: ${d}`));
  pythonProcess.stderr.on("data", (d) => console.error(`[PY ERR]: ${d}`));

  pythonProcess.on("error", (err) => {
    console.error("[PY FAIL] Failed to start python process:", err);
  });
}

// --- 5. App Lifecycle ---
app.whenReady().then(() => {
  // startPythonBackend(); // 1. Start Python
  startBackend();
  setupZMQ(); // 2. Connect Sockets
  createWindow(); // 3. Open Window
});

// Cleanup on Exit
app.on("will-quit", () => {
  // Kill Python process
  if (pythonProcess) {
    pythonProcess.kill();
  }
  // Close Sockets
  sockReq.close();
  sockSub.close();
});

// Mac-specific window behavior
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
