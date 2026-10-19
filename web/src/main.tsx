import { createRoot } from 'react-dom/client';
import './tokens.css';
import './app.css';
import { App } from './App.tsx';
createRoot(document.getElementById('root')!).render(<App />);
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
