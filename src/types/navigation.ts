export type RootStackParamList = {
  Bootstrap: undefined;
  SessionList: undefined;
  Chat: { sessionId: string; title: string; source?: 'remote-host' | 'local-provider'; providerName?: string | null; providerModel?: string | null };
  WorkspaceList: undefined;
  WorkspaceDetail: { workspaceId: string; workspaceName: string };
  HostConfig:
    | {
        version?: string;
        host?: string;
        relay?: string;
        relayId?: string;
        relayToken?: string;
        challenge?: string;
        code?: string;
      }
    | undefined;
  LocalProviderConfig: undefined;
  Settings: undefined;
  Search: undefined;
  Personalization: undefined;
  Plugins: undefined;
  ShiyanHome: undefined;
  ShiyanSceneSelect: undefined;
  ShiyanRecord: { sceneId: string; sceneName: string };
  ShiyanCaptureConfirm: { captureId: string };
  ShiyanLocalDrafts: undefined;
  ShiyanHistory: undefined;
  ShiyanTaskDetail: { taskId: string; localCaptureId?: string };
  ShiyanCloudConfig: undefined;
  ShiyanSceneConfig: undefined;
  ShiyanOrganizeRules: undefined;
  ReportError: undefined;
  About: undefined;
  License: undefined;
};

export type DrawerParamList = {
  Main: undefined;
  Settings: undefined;
};
