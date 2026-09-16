import './design/fonts.css';
import './design/tokens.css';
import { Providers } from './app/Providers.js';
import { AppRoot } from './app/AppRoot.js';

export function App() {
  return (
    <Providers>
      <AppRoot />
    </Providers>
  );
}
