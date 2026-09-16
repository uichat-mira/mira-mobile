import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { SHARE_CARD_WIDTH, ShareCardView } from './ShareCardView';
import type { ShareCardModel } from './shareCardModel';
import { captureRef } from './viewShotAdapter';

interface CaptureRequest {
  id: number;
  rootId: symbol;
  model: ShareCardModel;
  resolve: (uri: string) => void;
  reject: (error: Error) => void;
  timeoutMs: number;
}

interface CaptureRootRegistration {
  id: symbol;
  accept: (request: CaptureRequest) => boolean;
}

const DEFAULT_CAPTURE_TIMEOUT_MS = 10_000;
/** Header and footer logo each fire onLogoLoad once. */
const EXPECTED_LOGO_LOADS = 2;

let nextRequestId = 0;
let activeRequest: CaptureRequest | null = null;
let registeredRoots: CaptureRootRegistration[] = [];

const latestRegisteredRoot = (): CaptureRootRegistration | null =>
  registeredRoots[registeredRoots.length - 1] ?? null;

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
  const root = latestRegisteredRoot();
  if (!root) {
    return Promise.reject(new Error('Share capture root is not mounted'));
  }
  if (activeRequest) {
    return Promise.reject(new Error('A share image capture is already in progress'));
  }

  return new Promise<string>((resolve, reject) => {
    const request: CaptureRequest = {
      id: ++nextRequestId,
      rootId: root.id,
      model,
      resolve,
      reject,
      timeoutMs: Math.max(0, options.timeoutMs ?? DEFAULT_CAPTURE_TIMEOUT_MS),
    };
    activeRequest = request;

    try {
      if (!root.accept(request)) {
        if (activeRequest === request) activeRequest = null;
        reject(new Error('Share capture root is not mounted'));
      }
    } catch (error) {
      if (activeRequest === request) activeRequest = null;
      reject(
        error instanceof Error
          ? error
          : new Error('Share capture root failed to accept request'),
      );
    }
  });
}

export function ShareCardCaptureRoot() {
  const [request, setRequest] = useState<CaptureRequest | null>(null);
  const rootIdRef = useRef<symbol | null>(null);
  if (!rootIdRef.current) rootIdRef.current = Symbol('share-card-capture-root');
  const rootId = rootIdRef.current;

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
    const registration: CaptureRootRegistration = {
      id: rootId,
      accept: (nextRequest) => {
        // The caller may have captured this registration immediately before a
        // root replacement. Only the most recent live root can accept new work.
        if (latestRegisteredRoot() !== registration) return false;
        resetReadiness();
        setRequest(nextRequest);
        return true;
      },
    };

    registeredRoots = [...registeredRoots, registration];
    return () => {
      registeredRoots = registeredRoots.filter((root) => root !== registration);

      // Only reject work that belongs to this exact root instance. A stale
      // cleanup must never clear a request already owned by another live root.
      const pending = activeRequest;
      if (pending?.rootId !== registration.id) return;

      activeRequest = null;
      pending.reject(new Error('Share capture root was unmounted'));
    };
  }, [resetReadiness, rootId]);

  const settle = useCallback(
    (target: CaptureRequest, outcome: { uri: string } | { error: Error }) => {
      // A timed-out or unmounted capture can finish later. Never let that stale
      // native result settle a newer request that has since become active.
      if (activeRequest !== target || target.rootId !== rootId) return;

      activeRequest = null;
      setRequest(null);
      resetReadiness();
      if ('uri' in outcome) target.resolve(outcome.uri);
      else target.reject(outcome.error);
    },
    [resetReadiness, rootId],
  );

  useEffect(() => {
    if (!request) return undefined;
    const timeout = setTimeout(() => {
      settle(request, { error: new Error('Share image capture timed out') });
    }, request.timeoutMs);
    return () => clearTimeout(timeout);
  }, [request, settle]);

  const maybeCapture = useCallback(async () => {
    if (
      !request ||
      activeRequest !== request ||
      request.rootId !== rootId ||
      captureStartedRef.current
    ) {
      return;
    }
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
  }, [request, rootId, settle]);

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
