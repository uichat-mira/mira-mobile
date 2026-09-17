import React, { useEffect, useState } from 'react';
import { AppState, StatusBar, type AppStateStatus } from 'react-native';
import {
  NavigationContainer,
  type LinkingOptions,
} from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { BootstrapScreen } from './src/screens/BootstrapScreen';
import { SessionListScreen } from './src/screens/SessionListScreen';
import { AgentChatScreen } from './src/screens/AgentChatScreen';
import { WorkspaceListScreen } from './src/screens/WorkspaceListScreen';
import { WorkspaceDetailScreen } from './src/screens/WorkspaceDetailScreen';
import { HostConfigScreen } from './src/screens/HostConfigScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { LocalProviderConfigScreen } from './src/screens/LocalProviderConfigScreen';
import { SearchScreen } from './src/screens/SearchScreen';
import { PersonalizationScreen } from './src/screens/PersonalizationScreen';
import { StorageScreen } from './src/screens/StorageScreen';
import { ReportErrorScreen } from './src/screens/ReportErrorScreen';
import { AboutScreen } from './src/screens/AboutScreen';
import { LicenseScreen } from './src/screens/LicenseScreen';
import {
  PluginsScreen,
  ShiyanSceneConfigScreen,
} from './src/shiyan/ShiyanScreens';
import {
  ShiyanHomeScreen,
  ShiyanLocalDraftsScreen,
  ShiyanRecordScreen,
  ShiyanSceneSelectScreen,
} from './src/shiyan/ShiyanRecordingScreens';
import { ShiyanCaptureSubmitScreen } from './src/shiyan/ShiyanCaptureSubmitScreen';
import { ShiyanCloudConfigScreen } from './src/shiyan/ShiyanCloudConfigScreen';
import { ShiyanHistoryScreen } from './src/shiyan/ShiyanHistoryScreen';
import { ShiyanOrganizeRulesScreen } from './src/shiyan/ShiyanOrganizeRulesScreen';
import { ShiyanTaskDetailWithDeliveryScreen } from './src/shiyan/ShiyanTaskDetailWithDeliveryScreen';
import { ThemeProvider, useTheme } from './src/theme/ThemeContext';
import { TailscaleConnectivityLifecycle } from './src/connectivity/TailscaleConnectivityLifecycle';
import { remoteMiraHostClient } from './src/api/remoteMiraHost';
import { deviceCredentialStore } from './src/security/deviceCredentialStore';
import { useHostStore } from './src/store/hostStore';
import { runtimeRegistry } from './src/runtime/runtimeRegistry';
import { ShareCardCaptureRoot } from './src/share/ShareCardCapture';
import type { RootStackParamList } from './src/types/navigation';

const Stack = createNativeStackNavigator<RootStackParamList>();

const linking: LinkingOptions<RootStackParamList> = {
  prefixes: ['mira://'],
  config: {
    screens: {
      HostConfig: 'pair',
    },
  },
};

function StatusBarThemed() {
  const { theme, colors } = useTheme();
  useEffect(() => {
    StatusBar.setBarStyle(theme === 'dark' ? 'light-content' : 'dark-content');
    StatusBar.setBackgroundColor(colors.bg.canvas);
  }, [theme, colors]);
  return null;
}

function AppInner() {
  const [bootstrapChecked, setBootstrapChecked] = useState(false);
  const [hasDeviceCredential, setHasDeviceCredential] = useState(false);

  useEffect(() => {
    let previousState: AppStateStatus = AppState.currentState;
    let resumeGeneration = 0;
    const subscription = AppState.addEventListener('change', nextState => {
      runtimeRegistry.local.setExecutionSuspended(nextState !== 'active');
      if (nextState === 'active' && previousState !== 'active') {
        remoteMiraHostClient.refreshRelayConnection();
        if (useHostStore.getState().connectionStatus === 'connected') {
          const generation = ++resumeGeneration;
          useHostStore.getState().setConnectionStatus('reconnecting');
          void remoteMiraHostClient
            .restoreConnection()
            .then(restored => {
              if (generation !== resumeGeneration) return;
              useHostStore
                .getState()
                .setConnectionStatus(restored ? 'connected' : 'disconnected');
            })
            .catch(() => {
              if (generation !== resumeGeneration) return;
              useHostStore.getState().setConnectionStatus('reconnecting');
            });
        }
      }
      previousState = nextState;
    });
    return () => {
      resumeGeneration += 1;
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const bootstrapRemoteHost = async () => {
      try {
        if (!remoteMiraHostClient.isSecureStorageAvailable()) {
          if (!cancelled) {
            setHasDeviceCredential(false);
            useHostStore.getState().setConnectionStatus('disconnected');
          }
          return;
        }

        const stored = await deviceCredentialStore.load();
        if (cancelled) return;
        if (!stored) {
          setHasDeviceCredential(false);
          useHostStore.getState().setConnectionStatus('disconnected');
          return;
        }

        setHasDeviceCredential(true);
        try {
          const restored = await remoteMiraHostClient.restoreConnection();
          if (cancelled) return;

          const connected = restored != null;
          setHasDeviceCredential(connected);
          useHostStore
            .getState()
            .setConnectionStatus(connected ? 'connected' : 'disconnected');
        } catch {
          if (cancelled) return;

          // Direct or Relay may be temporarily unreachable. The paired-device
          // credential remains valid unless the Host explicitly returns 401/403.
          setHasDeviceCredential(true);
          useHostStore.getState().setConnectionStatus('reconnecting');
        }
      } finally {
        if (!cancelled) setBootstrapChecked(true);
      }
    };

    void bootstrapRemoteHost();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!bootstrapChecked) return null;

  return (
    <>
      <TailscaleConnectivityLifecycle />
      <Stack.Navigator
        initialRouteName={hasDeviceCredential ? 'SessionList' : 'Bootstrap'}
        screenOptions={{ headerShown: false }}
      >
        <Stack.Screen name="Bootstrap" component={BootstrapScreen} />
        <Stack.Screen name="SessionList" component={SessionListScreen} />
        <Stack.Screen name="Chat" component={AgentChatScreen} />
        <Stack.Screen name="WorkspaceList" component={WorkspaceListScreen} />
        <Stack.Screen name="WorkspaceDetail" component={WorkspaceDetailScreen} />
        <Stack.Screen name="HostConfig" component={HostConfigScreen} />
        <Stack.Screen name="Settings" component={SettingsScreen} />
        <Stack.Screen name="LocalProviderConfig" component={LocalProviderConfigScreen} />
        <Stack.Screen name="Search" component={SearchScreen} options={{ animation: 'none' }} />
        <Stack.Screen name="Personalization" component={PersonalizationScreen} />
        <Stack.Screen name="Storage" component={StorageScreen} />
        <Stack.Screen name="Plugins" component={PluginsScreen} />
        <Stack.Screen name="ShiyanHome" component={ShiyanHomeScreen} />
        <Stack.Screen name="ShiyanSceneSelect" component={ShiyanSceneSelectScreen} />
        <Stack.Screen name="ShiyanRecord" component={ShiyanRecordScreen} />
        <Stack.Screen name="ShiyanCaptureConfirm" component={ShiyanCaptureSubmitScreen} />
        <Stack.Screen name="ShiyanLocalDrafts" component={ShiyanLocalDraftsScreen} />
        <Stack.Screen name="ShiyanHistory" component={ShiyanHistoryScreen} />
        <Stack.Screen name="ShiyanTaskDetail" component={ShiyanTaskDetailWithDeliveryScreen} />
        <Stack.Screen name="ShiyanCloudConfig" component={ShiyanCloudConfigScreen} />
        <Stack.Screen name="ShiyanSceneConfig" component={ShiyanSceneConfigScreen} />
        <Stack.Screen name="ShiyanOrganizeRules" component={ShiyanOrganizeRulesScreen} />
        <Stack.Screen name="ReportError" component={ReportErrorScreen} />
        <Stack.Screen name="About" component={AboutScreen} />
        <Stack.Screen name="License" component={LicenseScreen} />
      </Stack.Navigator>
    </>
  );
}

function App() {
  return (
    <ThemeProvider>
      <SafeAreaProvider>
        <ShareCardCaptureRoot />
        <NavigationContainer linking={linking}>
          <StatusBarThemed />
          <AppInner />
        </NavigationContainer>
      </SafeAreaProvider>
    </ThemeProvider>
  );
}

export default App;
