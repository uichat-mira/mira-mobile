/**
 * @format
 */

import React, { useEffect, useState } from 'react';
import { AppRegistry } from 'react-native';
import { name as appName } from './app.json';
import { applyStartupTextScale } from './src/settings/generalSettings';

function StartupApp() {
  const [AppComponent, setAppComponent] = useState(null);

  useEffect(() => {
    let cancelled = false;

    applyStartupTextScale()
      .catch(() => undefined)
      .then(() => {
        if (cancelled) return;

        // App modules still load only after the startup text scale is applied,
        // but AppRegistry registration itself must remain synchronous.
        const LoadedApp = require('./App').default;
        setAppComponent(() => LoadedApp);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return AppComponent ? React.createElement(AppComponent) : null;
}

AppRegistry.registerComponent(appName, () => StartupApp);
