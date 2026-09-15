import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { captureRef } from 'react-native-view-shot';
import { SHARE_CARD_WIDTH, ShareCardView } from './ShareCardView';
import type { ShareCardModel } from './shareCardModel';

interface CaptureRequest {
  id: number;
  model: ShareCardModel;
  resolve: (uri: string) => void;
  reject: (error: Error) => void;
  timeoutMs: number;
}

const DEFAULT_CAPTURE_TIMEOUT_MS = 10_000;
/** Header and footer logo each fire onLogoLoad once. */
const EXPECTED_LOGO_LOADS = 2;

let nextRequestId = 0;
let activeRequest: CaptureRequest | null = null;
let notifyRoot: ((request: CaptureRequest) => void) | null = null;

export interface ShareCardCaptureOptions {
  timeoutMs?: number;
}

/**
 * Render the branded share card off-screen and rasterize it to a PNG file.
 * The root must stay mounted in the app tree. The request waits for layout and
 * both raster logo instances before invoking view-shot.
 */
export function requestShareCardCapture(
  model: ShareCardModel,
  options: ShareCardCaptureOptions = {},
): Promise<string> {
  if (!notifyRoot) {
    return Promise.reject(new Error('Share capture root is not mounted'));
  }
  if (activeRequest) {
    return Promise.reject(new Error('A share image capture is already in progress'));
  }

  return new Promise<string>((resolve, reject) => {
    const request: CaptureRequest = {
      id: ++nextRequestId,
      model,
      resolve,
      reject,
      timeoutMs: Math.max(0, options.timeoutMs ?? DEFAULT_CAPTURE_TIMEOUT_MS),
    };
    activeRequest = request;
    notifyRoot?.(request);
  });
}

export function ShareCardCaptureRoot() {
  const [request, setRequest] = useState<CaptureRequest | null>(null);
  const cardRef = useRef<View>(null);
  const layoutDoneRef = useRef(false);
  const logoLoadsRef = useRef(0);
  const captureStartedRef = useRef(false);

  const resetReadiness = useCallback(() => {
    layoutDoneRef.current = false;
    logoLoadsRef.current = 0;
    captureStartedRef.current = false;
  }, []);

  useEffect(() => {
    const rootNotifier = (nextRequest: CaptureRequest) => {
      resetReadiness();
      setRequest(nextRequest);
    };

    notifyRoot = rootNotifier;
    return () => {
      if (notifyRoot === rootNotifier) notifyRoot = null;
      const pending = activeRequest;
      activeRequest = null;
      if (pending) pending.reject(new Error('Share capture root was unmounted'));
    };
  }, [resetReadiness]);

  const settle = useCallback(
    (target: CaptureRequest, outcome: { uri: string } | { error: Error }) => {
      // A timed-out or unmounted capture can finish later. Never let that stale
      // native result settle a newer request that has since become active.
      if (activeRequest !== target) return;

      activeRequest = null;
      setRequest(null);
      resetReadiness();
      if ('uri' in outcome) target.resolve(outcome.uri);
      else target.reject(outcome.error);
    },
    [resetReadiness],
  );

  useEffect(() => {
    if (!request) return undefined;
    const timeout = setTimeout(() => {
      settle(request, { error: new Error('Share image capture timed out') });
    }, request.timeoutMs);
    return () => clearTimeout(timeout);
  }, [request, settle]);

  const maybeCapture = useCallback(async () => {
    if (!request || activeRequest !== request || captureStartedRef.current) return;
    if (!layoutDoneRef.current || logoLoadsRef.current < EXPECTED_LOGO_LOADS) return;

    captureStartedRef.current = true;
    try {
      const uri = await captureRef(cardRef, {
        format: 'png',
        quality: 1,
        result: 'tmpfile',
        fileName: 'mira-share-card',
      });
      settle(request, { uri });
    } catch (error) {
      settle(request, {
        error: error instanceof Error ? error : new Error('Share image capture failed'),
      });
    }
  }, [request, settle]);

  if (!request) return null;

  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={styles.hidden}
    >
      <View
        ref={cardRef}
        collapsable={false}
        testID="share-card-capture-target"
        onLayout={() => {
          layoutDoneRef.current = true;
          void maybeCapture();
        }}
      >
        <ShareCardView
          model={request.model}
          onLogoLoad={() => {
            logoLoadsRef.current += 1;
            void maybeCapture();
          }}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // Off-screen but still mounted and measured: view-shot rasterizes the view
  // itself, so it must neither be unmounted nor collapsed to zero size.
  hidden: {
    position: 'absolute',
    top: -10000,
    left: 0,
    width: SHARE_CARD_WIDTH,
  },
});
