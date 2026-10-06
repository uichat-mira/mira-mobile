import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { FileText, ImageIcon, X } from 'lucide-react-native';
import { miraHostClient } from '../api/miraHostClient';
import { RemoteHostError } from '../api/remoteHttp';
import { getFilePreviewKind } from '../media/messageAttachmentPolicy';
import type { RemoteMessagePart } from '../protocol/remoteHostV1';
import { useTheme } from '../theme/ThemeContext';
import { fontSize, radius, sizing, spacing } from '../theme/tokens';

type MediaRequest = { url: string; headers: Record<string, string> };
type ViewerSource = { uri: string; headers: Record<string, string> };
type AttachmentPart = Extract<RemoteMessagePart, { type: 'image' | 'file' }>;

const mediaErrorMessage = (error: unknown) => {
  if (error instanceof RemoteHostError) {
    if (error.code === 'THREAD_MEDIA_READ_UNAVAILABLE' || error.status === 403) {
      return '当前连接未授权读取此附件';
    }
    if (error.code === 'DIRECT_MEDIA_ENDPOINT_REQUIRED') {
      return '当前仅通过 Relay 连接，暂不能读取此附件';
    }
    if (error.status === 404) return '附件已失效或不存在';
    if (error.code === 'NETWORK_ERROR') return '无法连接 Mira Desktop 读取附件';
    if (error.code === 'MEDIA_READ_TIMEOUT') return '读取附件超时，请稍后重试';
    if (error.code === 'MEDIA_PREVIEW_TOO_LARGE') {
      return '文本附件过大，暂不支持应用内预览';
    }
    return error.message;
  }
  return error instanceof Error ? error.message : '附件读取失败';
};

const safeStandaloneUri = (value: string) => {
  const trimmed = value.trim();
  if (/^data:/iu.test(trimmed) || /^https:\/\//iu.test(trimmed)) return trimmed;
  if (__DEV__ && /^http:\/\//iu.test(trimmed)) return trimmed;
  return null;
};

function useMediaRequest(
  threadId: string,
  part: AttachmentPart,
  enabled: boolean = true,
) {
  const [request, setRequest] = useState<MediaRequest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(part.fileId) && enabled);

  useEffect(() => {
    let active = true;
    setRequest(null);
    setError(null);

    if (!enabled || !part.fileId) {
      setLoading(false);
      return () => {
        active = false;
      };
    }

    setLoading(true);
    void miraHostClient
      .getThreadMediaRequest(threadId, part.fileId)
      .then(next => {
        if (active) setRequest(next);
      })
      .catch(readError => {
        if (active) setError(mediaErrorMessage(readError));
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [enabled, part.fileId, threadId]);

  return { request, error, loading };
}

function TextAttachmentViewer({
  threadId,
  mediaId,
}: {
  threadId: string;
  mediaId: string;
}) {
  const { colors } = useTheme();
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setText(null);
    setError(null);

    void miraHostClient
      .getThreadMediaText(threadId, mediaId)
      .then(body => {
        if (active) setText(body);
      })
      .catch(readError => {
        if (active) setError(mediaErrorMessage(readError));
      });

    return () => {
      active = false;
    };
  }, [mediaId, threadId]);

  if (error) {
    return (
      <View style={styles.viewerState}>
        <Text style={[styles.viewerStateText, { color: colors.status.error }]}>{error}</Text>
      </View>
    );
  }

  if (text === null) {
    return (
      <View style={styles.viewerState}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <ScrollView style={styles.textViewer} contentContainerStyle={styles.textViewerContent}>
      <Text selectable style={[styles.textViewerText, { color: colors.text.ink }]}>
        {text}
      </Text>
    </ScrollView>
  );
}

function ImageAttachment({
  threadId,
  part,
}: {
  threadId: string;
  part: Extract<AttachmentPart, { type: 'image' }>;
}) {
  const { colors } = useTheme();
  const { request, error, loading } = useMediaRequest(threadId, part);
  const [imageFailed, setImageFailed] = useState(false);
  const standaloneUri = useMemo(() => safeStandaloneUri(part.image), [part.image]);
  const source = request
    ? { uri: request.url, headers: request.headers }
    : !part.fileId && standaloneUri
      ? { uri: standaloneUri }
      : null;

  useEffect(() => setImageFailed(false), [source?.uri]);

  if (loading) {
    return (
      <View style={[styles.imagePlaceholder, { backgroundColor: colors.bg.soft }]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (!source || error || imageFailed) {
    return (
      <View
        style={[
          styles.fallback,
          { backgroundColor: colors.bg.soft, borderColor: colors.border.default },
        ]}
      >
        <ImageIcon size={20} color={colors.text.muted} />
        <Text style={[styles.fallbackText, { color: colors.text.muted }]}>
          {error ?? '图片暂时无法预览'}
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.imageBlock}>
      {part.filename ? (
        <Text style={[styles.caption, { color: colors.text.muted }]} numberOfLines={1}>
          {part.filename}
        </Text>
      ) : null}
      <Image
        accessibilityLabel={part.filename ? `图片 ${part.filename}` : '会话图片'}
        source={source}
        resizeMode="contain"
        style={[styles.image, { backgroundColor: colors.bg.soft }]}
        onError={() => setImageFailed(true)}
      />
    </View>
  );
}

function FileAttachment({
  threadId,
  part,
}: {
  threadId: string;
  part: Extract<AttachmentPart, { type: 'file' }>;
}) {
  const { colors } = useTheme();
  const previewKind = useMemo(() => getFilePreviewKind(part.mimeType), [part.mimeType]);
  const { request, error, loading } = useMediaRequest(
    threadId,
    part,
    previewKind === 'image',
  );
  const [viewerVisible, setViewerVisible] = useState(false);
  const [viewerError, setViewerError] = useState<string | null>(null);
  const imageViewerSource: ViewerSource | null =
    previewKind === 'image' && request
      ? { uri: request.url, headers: request.headers }
      : null;
  const canOpenText = previewKind === 'text' && Boolean(part.fileId);
  const canOpenImage = previewKind === 'image' && Boolean(imageViewerSource);
  const unavailableMessage =
    viewerError ??
    error ??
    (previewKind === null
      ? '当前格式不可直接预览'
      : previewKind === 'text' && !part.fileId
        ? '附件缺少可读取的媒体标识'
        : previewKind === 'image' && !loading && !imageViewerSource
          ? '附件没有可读取的媒体地址'
          : null);

  return (
    <>
      <View
        style={[
          styles.fileCard,
          { backgroundColor: colors.bg.card, borderColor: colors.border.default },
        ]}
      >
        <FileText size={22} color={colors.text.muted} />
        <View style={styles.fileInfo}>
          <Text style={[styles.fileName, { color: colors.text.ink }]} numberOfLines={1}>
            {part.filename}
          </Text>
          <Text style={[styles.fileMeta, { color: colors.text.muted }]} numberOfLines={1}>
            {part.mimeType}
          </Text>
          {unavailableMessage ? (
            <Text
              style={[
                styles.errorText,
                { color: error || viewerError ? colors.status.error : colors.text.muted },
              ]}
            >
              {unavailableMessage}
            </Text>
          ) : null}
        </View>
        {loading ? (
          <ActivityIndicator color={colors.primary} />
        ) : canOpenText || canOpenImage ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`打开附件 ${part.filename}`}
            onPress={() => {
              setViewerError(null);
              setViewerVisible(true);
            }}
            style={({ pressed }) => [
              styles.openButton,
              { backgroundColor: pressed ? colors.primaryActive : colors.primary },
            ]}
          >
            <Text style={[styles.openButtonText, { color: colors.onPrimary }]}>查看</Text>
          </Pressable>
        ) : null}
      </View>

      <Modal
        visible={viewerVisible}
        animationType="slide"
        onRequestClose={() => setViewerVisible(false)}
      >
        <View style={[styles.viewer, { backgroundColor: colors.bg.canvas }]}>
          <View style={[styles.viewerHeader, { borderBottomColor: colors.border.soft }]}>
            <Text style={[styles.viewerTitle, { color: colors.text.ink }]} numberOfLines={1}>
              {part.filename}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="关闭附件"
              onPress={() => setViewerVisible(false)}
              style={styles.closeButton}
            >
              <X size={22} color={colors.text.ink} />
            </Pressable>
          </View>
          {imageViewerSource && previewKind === 'image' ? (
            <View style={styles.viewerImageContainer}>
              <Image
                source={imageViewerSource}
                resizeMode="contain"
                style={styles.viewerImage}
                onError={() => setViewerError('附件加载失败，请检查连接后重试')}
              />
            </View>
          ) : previewKind === 'text' && part.fileId ? (
            <TextAttachmentViewer threadId={threadId} mediaId={part.fileId} />
          ) : null}
        </View>
      </Modal>
    </>
  );
}

export function MessageAttachments({
  threadId,
  parts,
}: {
  threadId: string;
  parts?: readonly RemoteMessagePart[];
}) {
  const attachments = useMemo(
    () =>
      (parts ?? []).filter(
        (part): part is AttachmentPart => part.type === 'image' || part.type === 'file',
      ),
    [parts],
  );

  if (attachments.length === 0) return null;

  return (
    <View style={styles.container}>
      {attachments.map((part, index) =>
        part.type === 'image' ? (
          <ImageAttachment
            key={`image-${part.fileId ?? part.image}-${index}`}
            threadId={threadId}
            part={part}
          />
        ) : (
          <FileAttachment
            key={`file-${part.fileId ?? part.filename}-${index}`}
            threadId={threadId}
            part={part}
          />
        ),
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginTop: spacing.sm, gap: spacing.sm, minWidth: 220 },
  imageBlock: { gap: spacing.xs },
  caption: { fontSize: fontSize.sm },
  image: { width: 260, maxWidth: '100%', height: 190, borderRadius: radius.md },
  imagePlaceholder: {
    width: 260,
    maxWidth: '100%',
    height: 140,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fallback: {
    minHeight: 64,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    padding: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  fallbackText: { flex: 1, fontSize: fontSize.sm, lineHeight: 18 },
  fileCard: {
    minHeight: 68,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    padding: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  fileInfo: { flex: 1, gap: 2 },
  fileName: { fontSize: fontSize.bodyMd, fontWeight: '600' },
  fileMeta: { fontSize: fontSize.sm },
  errorText: { fontSize: fontSize.sm, lineHeight: 17 },
  openButton: {
    minWidth: 58,
    height: sizing.buttonHeight,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  openButtonText: { fontSize: fontSize.sm, fontWeight: '600' },
  viewer: { flex: 1 },
  viewerHeader: {
    height: 56,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: spacing.lg,
    paddingRight: spacing.sm,
  },
  viewerTitle: { flex: 1, fontSize: fontSize.bodyMd, fontWeight: '600' },
  closeButton: {
    width: sizing.touchTarget,
    height: sizing.touchTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewerState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  viewerStateText: { fontSize: fontSize.bodyMd, textAlign: 'center' },
  viewerImageContainer: { flex: 1, padding: spacing.md },
  viewerImage: { flex: 1, width: '100%' },
  textViewer: { flex: 1 },
  textViewerContent: { padding: spacing.lg },
  textViewerText: { fontSize: fontSize.bodyMd, lineHeight: 24 },
});