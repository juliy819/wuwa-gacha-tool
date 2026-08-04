import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { installGlobalLogging } from './services/logger';
import './index.css';

installGlobalLogging();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
