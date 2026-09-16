const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');

const chatSource = readFileSync(
  resolve(process.cwd(), 'src/screens/ChatScreen.tsx'),
  'utf8',
);
const cardSource = readFileSync(
  resolve(process.cwd(), 'src/components/LocalAgentRunCard.tsx'),
  'utf8',
);

describe('MOB-042 local Agent Loop UI contract', () => {
  it('keeps local Agent mode inside the existing ChatScreen and persists it per session', () => {
    expect(chatSource).toMatch(/runtime\s*\.\s*getAgentEnabled\(sessionId\)/);
    expect(chatSource).toMatch(
      /runtime\s*\.\s*setAgentEnabled\(sessionId,\s*next\)/,
    );
    expect(chatSource).toContain('agentEnabled: useLocalAgent');
    expect(chatSource).toContain('Agent 已开启');
    expect(chatSource).toContain('<Bot');
  });

  it('renders protocol-neutral tool lifecycle states without exposing raw arguments', () => {
    expect(chatSource).toContain("event.type === 'tool-call'");
    expect(chatSource).toContain("event.type === 'tool-running'");
    expect(chatSource).toContain("event.type === 'tool-result'");
    expect(chatSource).toContain("event.type === 'run-paused'");
    expect(cardSource).toContain('结果已截断');
    expect(cardSource).not.toContain('approval.arguments');
  });

  it('completes mobile approval through the runtime boundary', () => {
    expect(chatSource).toContain("event.type === 'approval-required'");
    expect(chatSource).toContain("event.type === 'approval-resolved'");
    expect(chatSource).toContain('runtime.resolveToolApproval(');
    expect(cardSource).toContain('批准工具调用');
    expect(cardSource).toContain('拒绝工具调用');
  });

  it('makes pause and failure states explicit in text, not color alone', () => {
    expect(cardSource).toContain('App 已进入后台');
    expect(cardSource).toContain('本轮运行已超时');
    expect(cardSource).toContain('你已停止本轮运行');
    expect(cardSource).toContain('该工具调用已拒绝');
    expect(cardSource).toContain('运行失败');
  });
});
