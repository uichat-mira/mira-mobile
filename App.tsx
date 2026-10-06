import React, { useEffect, useRef } from 'react';
import { StatusBar } from 'react-native';
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
import { MemoryScreen } from './src/screens/MemoryScreen';
import { StorageScreen } from './src/screens/StorageScreen';
import { GeneralSettingsScreen } from './src/screens/GeneralSettingsScreen';
import { NotificationSettingsScreen } from './src/screens/NotificationSettingsScreen';
import { ReportErrorScreen } from './src/screens/ReportErrorScreen';
import { AboutScreen } from './src/screens/AboutScreen';
import { LicenseScreen } from './src/screens/LicenseScreen';
import { SecurityScreen } from './src/screens/SecurityScreen';
import {
  PluginsScreen,
  ShiyanSceneConfigScreen,
} from './src/shiyan/ShiyanScreens';
import { ShiyanHomeScreen } from './src/shiyan/ShiyanHomeScreen';
import { ShiyanSceneSelectScreen } from './src/shiyan/ShiyanSceneSelectScreen';
import { ShiyanRecordScreen } from './src/shiyan/ShiyanRecordScreen';
import { ShiyanLocalDraftsScreen } from './src/shiyan/ShiyanLocalDraftsScreen';
import { ShiyanCaptureSubmitScreen } from './src/shiyan/ShiyanCaptureSubmitScreen';
import { ShiyanCloudConfigScreen } from './src/shiyan/ShiyanCloudConfigScreen';
import { ShiyanHistoryScreen } from './src/shiyan/ShiyanHistoryScreen';
import { ShiyanOrganizeRulesScreen } from './src/shiyan/ShiyanOrganizeRulesScreen';
import { ShiyanTaskDetailWithDeliveryScreen } from './src/shiyan/ShiyanTaskDetailWithDeliveryScreen';
import { ThemeProvider, useTheme } from './src/theme/ThemeContext';
import { TailscaleConnectivityLifecycle } from './src/connectivity/TailscaleConnectivityLifecycle';
import { useAppBootstrap } from './src/bootstrap/useAppBootstrap';
import { useAppLifecycle } from './src/bootstrap/useAppLifecycle';
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

/**
 * AppInner only composes the navigator around the inputs owned by the bootstrap
 * and lifecycle owners. `bootstrap` is committed as one object so "checked" and
 * "restore target" cannot be batched apart: nothing clears the target once it is
 * committed, so a valid last session cannot silently fall back to the list.
 */
function AppInner() {
  const bootstrap = useAppBootstrap();
  const bootstrapChecked = bootstrap !== null;
  const hasDeviceCredential = bootstrap?.hasDeviceCredential ?? false;
  const restoreTarget = bootstrap?.restoreTarget ?? null;
  const startupRestoreHandled = useRef(false);

  useAppLifecycle();

  // SessionList remains the stack root for an authenticated launch. A valid
  // restore target is consumed exactly once from SessionList's first focus and
  // pushed with the same Chat navigation contract as a normal list selection.
  // This preserves #206's restore intent without making Chat an unreturnable root.
  if (!bootstrapChecked) return null;

  return (
    <>
      <TailscaleConnectivityLifecycle />
      <Stack.Navigator
        initialRouteName={hasDeviceCredential ? 'SessionList' : 'Bootstrap'}
        screenOptions={{ headerShown: false }}
      >
        <Stack.Screen name="Bootstrap" component={BootstrapScreen} />
        <Stack.Screen
          name="SessionList"
          component={SessionListScreen}
          listeners={({ navigation }) => ({
            focus: () => {
              if (!restoreTarget || startupRestoreHandled.current) return;
              startupRestoreHandled.current = true;
              navigation.navigate('Chat', restoreTarget);
            },
          })}
        />
        <Stack.Screen name="Chat" component={AgentChatScreen} />
        <Stack.Screen name="WorkspaceList" component={WorkspaceListScreen} />
        <Stack.Screen name="WorkspaceDetail" component={WorkspaceDetailScreen} />
        <Stack.Screen name="HostConfig" component={HostConfigScreen} />
        <Stack.Screen name="Settings" component={SettingsScreen} />
        <Stack.Screen name="LocalProviderConfig" component={LocalProviderConfigScreen} />
        <Stack.Screen name="Search" component={SearchScreen} options={{ animation: 'none' }} />
        <Stack.Screen name="Personalization" component={PersonalizationScreen} />
        <Stack.Screen name="General" component={GeneralSettingsScreen} />
        <Stack.Screen name="Notifications" component={NotificationSettingsScreen} />
        <Stack.Screen name="Memory" component={MemoryScreen} />
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
        <Stack.Screen name="Security" component={SecurityScreen} />
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
