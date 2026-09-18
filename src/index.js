import React from 'react';
import ReactDOM from 'react-dom';
import './index.css';
import * as serviceWorker from './serviceWorker';
import { applyOverlay, loadOverlay, loadProblemPool } from './content/contentStore';

const root = document.getElementById('root');

// App and config.js read the content when their modules load, so the problem
// pool and any imported courses have to be in place first. A static import of
// either (or of LocalizationContext, which pulls in config.js) would run them too early.
const overlay = loadOverlay().catch(err => {
  console.warn('Imported courses are unavailable; showing built-in content only.', err);
  return null;
});

loadProblemPool()
  .then(() => overlay)
  .then(applyOverlay)
  .then(() => Promise.all([import('./App'), import('./util/LocalizationContext')]))
  .then(
    ([{ default: App }, { LocalizationProvider }]) => {
      ReactDOM.render(
        <LocalizationProvider>
          <App />
        </LocalizationProvider>,
        root
      );
    },
    err => {
      console.error(err);
      root.textContent = 'OATutor could not load its problems. Please reload the page.';
    }
  );

// If you want your app to work offline and load faster, you can change
// unregister() to register() below. Note this comes with some pitfalls.
// Learn more about service workers: https://bit.ly/CRA-PWA
serviceWorker.unregister();
