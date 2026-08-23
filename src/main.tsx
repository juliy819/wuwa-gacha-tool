import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { installGlobalLogging } from './services/logger';
import './index.css';

installGlobalLogging();

// The desktop app does not expose browser actions such as refresh or print.
document.addEventListener('contextmenu', (event) => event.preventDefault());

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
