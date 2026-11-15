import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { App } from './App';
import { startSimController } from './state/simController';

startSimController();
createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
// Debug/automation handle (read-only use): window.__smdg.getState()
import { useStore } from './state/store';
(window as unknown as { __smdg: typeof useStore }).__smdg = useStore;
import { getEngine } from './game/GameCanvas';
(window as unknown as { __smdgEngine: typeof getEngine }).__smdgEngine = getEngine;
