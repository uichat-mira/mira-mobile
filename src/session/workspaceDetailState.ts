export const getWorkspaceDetailContractError = (
  workspaceId: string,
  workspaceName: string,
): string | null => {
  if (!workspaceId.trim()) return '缺少项目标识，无法读取项目会话';
  if (!workspaceName.trim()) return '缺少项目名称，无法确认当前项目';
  return null;
};
