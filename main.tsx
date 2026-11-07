import ReactDOM from 'react-dom/client';
import { startPwa } from './pwa';
import { initAiCache } from './aicache';
import App from './App';
import './styles.css';

startPwa();

// 저장된 AI 해설(IndexedDB)을 먼저 읽고 화면을 그림 (아주 오래 걸리면 그냥 시작)
const render = () => ReactDOM.createRoot(document.getElementById('root')!).render(<App />);
let done = false;
const go = () => { if (!done) { done = true; render(); } };
initAiCache().finally(go);
setTimeout(go, 2500);
