import { useState, useEffect } from 'react';
import './App.css';

function App() {
  const [status, setStatus] = useState('Idle');
  const [logs, setLogs] = useState([]);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    // Listen for updates from Electron Main Process
    const removeListener = window.api.onUpdate((msg) => {
      // msg is "TOPIC JSON_DATA"
      const [topic, ...rest] = msg.split(' ');
      const dataStr = rest.join(' ');
      
      // Add to logs
      setLogs((prev) => [...prev, `[${topic}] ${dataStr}`]);

      // If it's progress, parse it to update the bar
      if (topic === 'progress') {
        try {
            // NOTE: Ensure your Python sends valid JSON with double quotes!
            // e.g. {"value": 50}
            const data = JSON.parse(dataStr.replace(/'/g, '"')); 
            if (data.value) setProgress(data.value);
        } catch (e) {
            console.error("JSON Parse Error", e);
        }
      }
    });

    // Cleanup listener on unmount
    return () => removeListener();
  }, []);

  const handleStart = async () => {
    setStatus('Requesting...');
    setLogs([]);
    setProgress(0);

    // Call the Bridge
    const reply = await window.api.sendJob('Start-Analysis');
    
    // Parse the Python Reply
    // e.g. "{'status': 'started', 'id': '123'}"
    setStatus(`Backend Reply: ${reply}`);
  };

  return (
    <div className="container">
      <h1>React + Electron + Python</h1>
      
      <div className="card">
        <button onClick={handleStart}>
           Start Heavy Job
        </button>
        <p>Status: {status}</p>
      </div>

      <div className="progress-bar-bg">
        <div 
            className="progress-bar-fill" 
            style={{ width: `${progress}%` }}
        ></div>
      </div>

      <div className="logs">
        <h3>Live Logs:</h3>
        <ul>
          {logs.map((log, index) => (
            <li key={index}>{log}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export default App;
