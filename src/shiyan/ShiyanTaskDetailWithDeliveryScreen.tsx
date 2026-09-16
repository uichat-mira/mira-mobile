import React, { useCallback, useRef, useState } from 'react';
import { Alert, Linking } from 'react-native';
import { useFocusEffect, useRoute, type RouteProp } from '@react-navigation/native';
import type { RootStackParamList } from '../types/navigation';
import {
  ShiyanTaskDetailScreen,
  type ShiyanFinalEditorState,
} from './ShiyanTaskDetailScreen';
import { shiyanClient, ShiyanClientError } from './client/ShiyanClient';
import {
  hasCanonicalGithubDeliveryEvidence,
  parseShiyanDeliveriesResult,
  type ShiyanDeliveryView,
  type ShiyanFinalDraftView,
} from './client/contracts';
import {
  deliverFinalDraftToGithub,
  deliveryBelongsToFinalDraft,
} from './client/delivery';

type DetailRoute = RouteProp<RootStackParamList, 'ShiyanTaskDetail'>;

const EMPTY_EDITOR_STATE: ShiyanFinalEditorState = {
  open: false,
  dirty: false,
  saving: false,
};

export function ShiyanTaskDetailWithDeliveryScreen() {
  const route = useRoute<DetailRoute>();
  const taskId = route.params.taskId;
  const [finalDraft, setFinalDraft] = useState<ShiyanFinalDraftView | null>(null);
  const [delivery, setDelivery] = useState<ShiyanDeliveryView | null>(null);
  const [deliveryError, setDeliveryError] = useState('');
  const [busy, setBusy] = useState(false);
  const [editorState, setEditorState] = useState<ShiyanFinalEditorState>(EMPTY_EDITOR_STATE);
  const previousSaving = useRef(false);
  const refreshGeneration = useRef(0);
  const focused = useRef(false);
  const deliveryBusy = useRef(false);

  const refreshDeliveryState = useCallback(async (force = false) => {
    if (!focused.current || (deliveryBusy.current && !force)) return;
    const generation = ++refreshGeneration.current;
    const isCurrent = () => focused.current && refreshGeneration.current === generation;

    let nextFinalDraft: ShiyanFinalDraftView | null = null;
    try {
      const result = await shiyanClient.getFinalDraft(taskId);
      if (!isCurrent()) return;
      nextFinalDraft = result.draft;
      setFinalDraft(result.draft);
    } catch (error) {
      if (!isCurrent()) return;
      if (error instanceof ShiyanClientError && error.code === 'final_draft_not_ready') {
        setFinalDraft(null);
        setDelivery(null);
        setDeliveryError('');
      }
      return;
    }

    try {
      const raw = await shiyanClient.getDeliveries(taskId);
      if (!isCurrent()) return;
      const result = parseShiyanDeliveriesResult(raw, taskId);
      if (!result) {
        throw new ShiyanClientError(
          '投递记录返回不完整。',
          'invalid_response',
          true,
          taskId,
        );
      }
      const matching = result.deliveries.filter((item) =>
        nextFinalDraft ? deliveryBelongsToFinalDraft(item, nextFinalDraft) : false,
      );
      const succeeded = matching.find(hasCanonicalGithubDeliveryEvidence);
      if (succeeded) {
        setDelivery(succeeded);
        setDeliveryError('');
        return;
      }
      const failed = matching.find((item) => item.status === 'failed') ?? null;
      setDelivery(failed);
      setDeliveryError(failed?.errorMessage ?? '');
    } catch (error) {
      if (!isCurrent()) return;
      setDeliveryError(error instanceof Error ? error.message : '暂时无法读取投递状态。');
    }
  }, [taskId]);

  useFocusEffect(
    useCallback(() => {
      focused.current = true;
      void refreshDeliveryState();
      const timer = setInterval(() => {
        void refreshDeliveryState();
      }, 5000);
      return () => {
        focused.current = false;
        refreshGeneration.current += 1;
        clearInterval(timer);
      };
    }, [refreshDeliveryState]),
  );

  const handleEditorStateChange = useCallback(
    (next: ShiyanFinalEditorState) => {
      const justFinishedSaving = previousSaving.current && !next.saving && !next.dirty;
      previousSaving.current = next.saving;
      setEditorState(next);
      if (justFinishedSaving) void refreshDeliveryState();
    },
    [refreshDeliveryState],
  );

  const deliveryBlocked = editorState.dirty || editorState.saving;

  const deliver = async () => {
    if (!finalDraft || busy || deliveryBlocked) return;
    deliveryBusy.current = true;
    refreshGeneration.current += 1;
    setBusy(true);
    setDeliveryError('');
    try {
      const latest = await shiyanClient.getFinalDraft(taskId);
      setFinalDraft(latest.draft);
      const result = await deliverFinalDraftToGithub(taskId, latest.draft);
      setDelivery(result.record);
      Alert.alert('已投递 GitHub', '当前最终稿已写入 GitHub。');
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'GitHub 投递失败，可以直接重试。';
      setDeliveryError(message);
      Alert.alert('GitHub 投递未完成', `${message}\n\n最终稿仍然安全，可以再次投递。`);
      await refreshDeliveryState(true);
    } finally {
      deliveryBusy.current = false;
      setBusy(false);
    }
  };

  const openDelivery = async () => {
    if (!delivery || deliveryBlocked || !hasCanonicalGithubDeliveryEvidence(delivery)) return;
    refreshGeneration.current += 1;
    try {
      const latest = await shiyanClient.getFinalDraft(taskId);
      if (!deliveryBelongsToFinalDraft(delivery, latest.draft)) {
        setFinalDraft(latest.draft);
        setDelivery(null);
        await refreshDeliveryState();
        return;
      }
      await Linking.openURL(delivery.fileUrl!);
    } catch (error) {
      if (error instanceof ShiyanClientError) {
        setDeliveryError(error.message);
        Alert.alert('无法打开已投递文档', error.message);
        return;
      }
      Alert.alert('无法打开 GitHub', '当前投递链接暂时不可用。');
    }
  };

  const currentSucceeded = Boolean(
    finalDraft &&
      delivery &&
      deliveryBelongsToFinalDraft(delivery, finalDraft) &&
      hasCanonicalGithubDeliveryEvidence(delivery),
  );
  const deliveryFailed = delivery?.status === 'failed';

  const statusCopy = deliveryBlocked
    ? editorState.saving
      ? '正在保存最终稿，保存后才能投递。'
      : '当前最终稿有未保存修改，请先保存再投递。'
    : currentSucceeded
      ? '当前最终稿已投递，可打开真实文档。'
      : deliveryFailed
        ? `上次投递未完成，最终稿仍然安全，可以再次投递。${deliveryError ? ` ${deliveryError}` : ''}`
        : deliveryError
          ? `暂时无法读取投递状态，最终稿仍然安全。 ${deliveryError}`
          : '把当前已确认的最终稿写入 GitHub。';

  return (
    <ShiyanTaskDetailScreen
      onFinalEditorStateChange={handleEditorStateChange}
      deliveryActions={{
        available: Boolean(finalDraft),
        busy,
        blocked: deliveryBlocked,
        succeeded: currentSucceeded,
        failed: deliveryFailed,
        statusText: statusCopy,
        onDeliver: () => void deliver(),
        onOpenDelivery: () => void openDelivery(),
      }}
    />
  );
}
