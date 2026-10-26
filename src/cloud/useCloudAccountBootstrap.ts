import { useEffect } from 'react';
import { useCloudAccountStore } from './cloudAccountStore';

export const useCloudAccountBootstrap = (): void => {
  const initialize = useCloudAccountStore(state => state.initialize);
  useEffect(() => {
    void initialize();
  }, [initialize]);
};
