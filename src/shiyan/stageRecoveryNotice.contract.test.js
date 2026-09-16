const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');

const source = readFileSync(
  resolve(process.cwd(), 'src/shiyan/ShiyanStageRecoveryNotice.tsx'),
  'utf8',
);

describe('MOB-033 local upload recovery contract', () => {
  it('resolves a local capture from route context and falls back to the persisted submission pointer', () => {
    expect(source).toContain('const routeCaptureId = route.params.localCaptureId ?? null;');
    expect(source).toContain('localCaptureRepository.get(routeCaptureId)');
    expect(source).toContain('shiyanSubmissionRepository.findByTaskId(route.params.taskId)');
    expect(source).toContain('localCaptureRepository.get(pointer.localCaptureId)');
    expect(source).toContain('const capture = routeCapture ?? pointerCapture;');
  });

  it('routes a recoverable upload back through the existing confirmation submission flow', () => {
    expect(source).toContain("recovery.retryAction === 'resume-upload'");
    expect(source).toContain("navigation.navigate('ShiyanCaptureConfirm', { captureId: uploadRecoveryCaptureId })");
  });

  it('does not render the upload recovery action when local capture evidence is absent', () => {
    expect(source).toContain('Boolean(uploadRecoveryCaptureId)');
    expect(source).toContain('当前设备没有找到可继续上传的本地录音');
  });
});
