import React from 'react';
import ReactDOM from 'react-dom';
import './index.css';
import * as serviceWorker from './serviceWorker';
import { loadUser, signInUrl } from './auth/session';
import { applyOverlay, loadOverlay, loadProblemPool } from './content/contentStore';

const root = document.getElementById('root');

function showSignInFailed() {
  const retry = document.createElement('a');
  // Without the error in the address, so the next attempt starts clean.
  retry.href = `${window.location.pathname}${window.location.hash}`;
  retry.textContent = 'Try again';
  root.replaceChildren('Signing in did not work. ', retry);
}

// App and config.js read the content when their modules load, so the problem
// pool and any imported courses have to be in place first. A static import of
// either (or of LocalizationContext, which pulls in config.js) would run them too early.
async function start() {
  const user = await loadUser();
  if (!user) {
    // Coming back from a failed sign-in, sending the visitor there again would loop.
    if (new URLSearchParams(window.location.search).has('auth_error')) return showSignInFailed();
    return window.location.assign(signInUrl());
  }

  // The overlay is only served to signed-in users, so it cannot start before this.
  const overlay = loadOverlay().catch(err => {
    console.warn('Imported courses are unavailable; showing built-in content only.', err);
    return null;
  });
  await loadProblemPool();
  applyOverlay(await overlay);

  const [{ default: App }, { LocalizationProvider }] = await Promise.all([
    import('./App'),
    import('./util/LocalizationContext'),
  ]);
  ReactDOM.render(
    <LocalizationProvider>
      <App />
    </LocalizationProvider>,
    root
  );
}

start().catch(err => {
  console.error(err);
  root.textContent = 'OATutor could not load. Please reload the page.';
});

// If you want your app to work offline and load faster, you can change
// unregister() to register() below. Note this comes with some pitfalls.
// Learn more about service workers: https://bit.ly/CRA-PWA
serviceWorker.unregister();
