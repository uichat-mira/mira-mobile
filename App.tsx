import React, { useEffect, useRef, useState } from 'react';
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
import { MemoryScreen } from './src/screens/MemoryScreen';
import { StorageScreen } from './src/screens/StorageScreen';
import { GeneralSettingsScreen } from './src/screens/GeneralSettingsScreen';
import { NotificationSettingsScreen } from './src/screens/NotificationSettingsScreen';
import { ReportErrorScreen } from './src/screens/ReportErrorScreen';
import { AboutScreen } from './src/screens/AboutScreen';
import { LicenseScreen } from './src/screens/LicenseScreen';
import { releaseChannel } from 'mira-release-channel';
import { version } from './package.json';
import { SecurityScreen } from './src/screens/SecurityScreen';
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
import { miraHostClient } from './src/api/miraHostClient';
import { deviceCredentialStore } from './src/security/deviceCredentialStore';
import { useHostStore } from './src/store/hostStore';
import { runtimeRegistry } from './src/runtime/runtimeRegistry';
import { classifyAvailableUpdate, fetchLatestRelease } from './src/update/appUpdate';
import { parseSemver } from './src/update/semver';
import { presentUpdatePrompt } from './src/update/updatePrompt';
import { DEFAULT_GENERAL_SETTINGS, loadGeneralSettings } from './src/screens/generalSettings';
import {
  loadLastOpenedSession,
  type LastOpenedSession,
} from './src/screens/lastOpenedSession';
import { ShareCardCaptureRoot } from './src/share/ShareCardCapture';
import type { RootStackParamList } from './src/types/navigation';

const Stack = createNativeStackNavigator<RootStackParamList>();

/**
 * Whether a stored restore target can be confirmed gone.
 *
 * - `restore`: the session exists, or the authority that owns it cannot be
 *   reached right now. An unreachable Host must not be silently reinterpreted as
 *   "this session was deleted"; the restore intent is preserved and the existing
 *   chat error/retry path explains the connection problem instead.
 * - `drop`: the owning authority authoritatively reports the session is absent,
 *   so the app safely falls back to the session list.
 */
type RestoreVerdict = 'restore' | 'drop';

/**
 * Local sessions live on this device, so device storage is authoritative: an
 * absent id is dropped, and a listing failure is treated as "cannot confirm"
 * and also dropped, matching the existing local fallback behavior.
 */
async function resolveLocalRestoreVerdict(target: LastOpenedSession): Promise<RestoreVerdict> {
  return runtimeRegistry.local
    .listSessions()
    .then((sessions) => (sessions.some((session) => session.id === target.sessionId) ? 'restore' : 'drop'))
    .catch(() => 'drop');
}

/**
 * Remote sessions are owned by the Host. Only a connected Host that can list
 * sessions is authoritative: if it lists them and the id is absent, the session
 * is genuinely gone. While the Host is reconnecting/unavailable, or when the
 * listing itself fails, the verdict is `restore` so the app still opens the
 * chat and lets the existing error/retry path surface the connection problem.
 */
async function resolveRemoteRestoreVerdict(target: LastOpenedSession): Promise<RestoreVerdict> {
  if (useHostStore.getState().connectionStatus !== 'connected') return 'restore';

  return miraHostClient
    .listSessions()
    .then((sessions) => (sessions.some((session) => session.id === target.sessionId) ? 'restore' : 'drop'))
    .catch(() => 'restore');
}

/**
 * Resolves the cold-start restore target once, during bootstrap. Returns the
 * stored record when it can be restored, and null only when the owning authority
 * has authoritatively confirmed it no longer exists. This is the single decision
 * point for the "last session" launch behavior and must run before the navigator
 * commits its initial route.
 */
async function resolveRestoreTarget(): Promise<LastOpenedSession | null> {
  const lastOpened = await loadLastOpenedSession().catch(() => null);
  if (!lastOpened) return null;

  const verdict =
    lastOpened.source === 'local-provider'
      ? await resolveLocalRestoreVerdict(lastOpened)
      : await resolveRemoteRestoreVerdict(lastOpened);

  return verdict === 'restore' ? lastOpened : null;
}

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

interface BootstrapResolution {
  hasDeviceCredential: boolean;
  restoreTarget: LastOpenedSession | null;
}

/**
 * Bootstrap resolves the startup route in one committed step. `bootstrapChecked`
 * alone is not enough to gate the navigator: the restore target used to live in
 * separate state and was cleared by a follow-up effect before the navigator ever
 * mounted, so a valid last session silently fell back to the list. Keeping both
 * values in a single object makes "checked" and "restore target" impossible to
 * batch apart, and nothing clears the target once it is committed.
 */
function AppInner() {
  const [bootstrap, setBootstrap] = useState<BootstrapResolution | null>(null);
  const bootstrapChecked = bootstrap !== null;
  const hasDeviceCredential = bootstrap?.hasDeviceCredential ?? false;
  const restoreTarget = bootstrap?.restoreTarget ?? null;
  const startupRestoreHandled = useRef(false);

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
      let credentialPresent = false;
      let resolvedRestoreTarget: LastOpenedSession | null = null;

      try {
        if (!remoteMiraHostClient.isSecureStorageAvailable()) {
          if (!cancelled) {
            useHostStore.getState().setConnectionStatus('disconnected');
          }
          return;
        }

        const stored = await deviceCredentialStore.load();
        if (cancelled) return;
        if (!stored) {
          useHostStore.getState().setConnectionStatus('disconnected');
          return;
        }

        credentialPresent = true;
        try {
          const restored = await remoteMiraHostClient.restoreConnection();
          if (cancelled) return;

          const connected = restored != null;
          credentialPresent = connected;
          useHostStore
            .getState()
            .setConnectionStatus(connected ? 'connected' : 'disconnected');
        } catch {
          if (cancelled) return;

          // Direct or Relay may be temporarily unreachable. The paired-device
          // credential remains valid unless the Host explicitly returns 401/403.
          credentialPresent = true;
          useHostStore.getState().setConnectionStatus('reconnecting');
        }

        const settings = await loadGeneralSettings().catch(() => DEFAULT_GENERAL_SETTINGS);
        if (cancelled) return;

        if (settings.launchBehavior === 'last-session') {
          resolvedRestoreTarget = await resolveRestoreTarget();
          if (cancelled) return;
        }

        if (settings.autoCheckUpdates) {
          // The prompt must never fire for an unmounted tree, so bootstrap's own
          // cancellation flag also guards this alert.
          const latest = await fetchLatestRelease(releaseChannel, fetch).catch(() => null);
          if (cancelled || !latest) return;

          // Only major/minor bumps interrupt the user. A patch-only release is
          // quiet-notified through the About badge (same source of truth) and
          // must not auto-prompt. A broken installed semver is treated as
          // "cannot decide" rather than silently as no update.
          const current = parseSemver(version);
          if (!current) return;
          const level = classifyAvailableUpdate(current, latest);
          if (level === 'major' || level === 'minor') {
            presentUpdatePrompt(latest);
          }
        }
      } finally {
        if (!cancelled) {
          // Single commit: the navigator mounts once with both the credential
          // state and the resolved restore target already in place.
          setBootstrap({
            hasDeviceCredential: credentialPresent,
            restoreTarget: resolvedRestoreTarget,
          });
        }
      }
    };
    void bootstrapRemoteHost();
    return () => {
      cancelled = true;
    };
  }, []);

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
