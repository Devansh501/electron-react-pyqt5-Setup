import sys
import time
import json
import uuid
import zmq
from PyQt5.QtCore import QCoreApplication, QTimer, QObject, QThread, pyqtSignal

# --- 1. The Worker Thread (Handles Heavy Logic) ---
class Worker(QThread):
    # Signal to send updates back to the main thread
    # Format: (topic, message_string)
    update_signal = pyqtSignal(str, str)

    def __init__(self, task_name, task_id):
        super().__init__()
        self.task_name = task_name
        self.task_id = task_id

    def run(self):
        """
        This function runs in a separate thread.
        It simulates a heavy process (like data analysis or hardware control).
        """
        steps = 5
        for i in range(1, steps + 1):
            time.sleep(1)  # Simulate 1 second of work
            progress = int((i / steps) * 100)
            
            # Create a secure JSON payload
            payload = json.dumps({
                "id": self.task_id,
                "status": "running",
                "value": progress,
                "message": f"Processing step {i} of {steps}..."
            })
            
            # Emit progress update (Topic: 'progress')
            self.update_signal.emit("progress", payload)
        
        # Emit finished signal (Topic: 'result')
        final_payload = json.dumps({
            "id": self.task_id,
            "status": "completed",
            "data": f"Analysis of '{self.task_name}' is complete."
        })
        self.update_signal.emit("result", final_payload)


# --- 2. The Main Server (Manages Sockets) ---
class HybridServer(QObject):
    def __init__(self):
        super().__init__()
        self.context = zmq.Context()

        # Socket 1: REP (Reply) - For receiving Commands
        # Electron sends a request here, we reply immediately with a Task ID.
        self.rep_socket = self.context.socket(zmq.REP)
        self.rep_socket.bind("tcp://127.0.0.1:5555")

        # Socket 2: PUB (Publish) - For streaming Updates
        # We broadcast progress bars and logs here. Electron listens silently.
        self.pub_socket = self.context.socket(zmq.PUB)
        self.pub_socket.bind("tcp://127.0.0.1:5556")
        
        # Use QTimer to check for commands without blocking the Event Loop
        self.timer = QTimer()
        self.timer.timeout.connect(self.check_requests)
        self.timer.start(50)  # Check every 50ms
        
        # Dictionary to keep active workers alive (prevent Garbage Collection)
        self.active_workers = {}

    def check_requests(self):
        try:
            # Check for new commands (Non-blocking)
            msg = self.rep_socket.recv_string(flags=zmq.NOBLOCK)
            print(f"[CMD] Received: {msg}")

            # Generate a unique ID for this task
            task_id = str(uuid.uuid4())[:8]

            # --- A. Start the background work ---
            worker = Worker(msg, task_id)
            
            # Connect the worker's signal to our broadcast function
            worker.update_signal.connect(self.broadcast_update)
            
            # Clean up worker reference when it finishes
            worker.finished.connect(lambda: self.cleanup_worker(task_id))
            
            # Store and start
            self.active_workers[task_id] = worker
            worker.start()

            # --- B. Send Instant Reply (REQ/REP) ---
            # We use json.dumps to ensure strict JSON format for JS
            reply = json.dumps({
                "status": "started", 
                "id": task_id,
                "original_request": msg
            })
            self.rep_socket.send_string(reply)

        except zmq.Again:
            pass # No message waiting, just loop again

    def broadcast_update(self, topic, message):
        """
        Sends a message to the React Frontend via the PUB socket.
        Format: "TOPIC JSON_DATA"
        """
        # print(f"[PUB] {topic}: {message}") # Optional: Debug print
        self.pub_socket.send_string(f"{topic} {message}")

    def cleanup_worker(self, task_id):
        if task_id in self.active_workers:
            # print(f"[SYS] Cleaning up worker {task_id}")
            del self.active_workers[task_id]

if __name__ == "__main__":
    # Create the Qt Application (Headless)
    app = QCoreApplication(sys.argv)
    
    server = HybridServer()
    
    print("--------------------------------------------------")
    print(" Python Backend Running (Hybrid Mode)")
    print(" - Commands (REQ/REP): tcp://127.0.0.1:5555")
    print(" - Updates  (PUB/SUB): tcp://127.0.0.1:5556")
    print("--------------------------------------------------")
    
    # Start the Event Loop
    sys.exit(app.exec_())
