/**
 * @format
 */

import { AppRegistry } from 'react-native';
import { name as appName } from './app.json';
import { applyStartupTextScale } from './src/screens/generalSettings';

applyStartupTextScale()
  .catch(() => undefined)
  .then(() => {
    // App modules must load after the text scale is applied so that
    // module-level StyleSheet.create calls pick up the scaled font tokens.
    const App = require('./App').default;
    AppRegistry.registerComponent(appName, () => App);
  });
