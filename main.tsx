import ReactDOM from 'react-dom/client';
import { startPwa } from './pwa';
import App from './App';
import './styles.css';

startPwa();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <App />,
);
