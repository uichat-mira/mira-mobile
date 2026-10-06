import {
  FakeXhr,
  collect,
  completedResponse,
  createQueuedResponsesClient,
  functionCallItem,
  outputItemDone,
  reasoningItem,
  request,
  searchCallMessage,
  searchTool,
  sse,
  toolResultMessage,
} from './openAiStandardClientTestSupport';

describe('OpenAiStandardClient Responses continuation', () => {
it('replays opaque reasoning output items across a Responses tool round', async () => {
    const reasoning = reasoningItem('rs-1', 'opaque-reasoning');
    const call = functionCallItem(
      'fc-1',
      'call-1',
      '{"q":"mira"}',
    );
    const firstXhr = new FakeXhr(
      sse(
        outputItemDone(0, reasoning),
        outputItemDone(1, call),
        completedResponse([reasoning, call]),
      ),
    );
    const secondXhr = new FakeXhr(sse(completedResponse([])));
    const client = createQueuedResponsesClient([firstXhr, secondXhr]);

    const firstStream = await client.streamMessages(
      request('find', { tools: [searchTool] }),
    );
    await expect(collect(firstStream)).resolves.toEqual([
      {
        type: 'tool-call',
        callId: 'call-1',
        name: 'search',
        arguments: '{"q":"mira"}',
      },
      { type: 'finish', reason: 'tool_calls' },
    ]);

    await collect(await client.streamMessages(
      request('find', {
        messages: [
          { role: 'user', content: 'find' },
          searchCallMessage('call-1', '{"q":"mira"}'),
          toolResultMessage('call-1', '{"result":"ok"}'),
        ],
        tools: [searchTool],
      }),
    ));

    const secondRequest = JSON.parse(secondXhr.requestBody ?? '{}');
    expect(secondRequest.include).toEqual(['reasoning.encrypted_content']);
    expect(secondRequest.input).toEqual([
      { role: 'user', content: 'find' },
      reasoning,
      call,
      {
        type: 'function_call_output',
        call_id: 'call-1',
        output: '{"result":"ok"}',
      },
    ]);
  });

  it('clears chat continuation before a later same-client consolidation request', async () => {
    const reasoning = reasoningItem('rs-chat', 'chat-reasoning');
    const call = functionCallItem(
      'fc-chat',
      'call-chat',
      '{"q":"mira"}',
    );
    const firstXhr = new FakeXhr(
      sse(
        outputItemDone(0, reasoning),
        outputItemDone(1, call),
        completedResponse([reasoning, call]),
      ),
    );
    const secondXhr = new FakeXhr(
      sse(
        {
          type: 'response.output_text.delta',
          output_index: 0,
          content_index: 0,
          delta: 'done',
        },
        completedResponse([]),
      ),
    );
    const consolidationXhr = new FakeXhr(sse(completedResponse([])));
    const client = createQueuedResponsesClient([
      firstXhr,
      secondXhr,
      consolidationXhr,
    ]);

    await collect(await client.streamMessages(
      request('find', { tools: [searchTool] }),
    ));
    await collect(await client.streamMessages(
      request('find', {
        messages: [
          { role: 'user', content: 'find' },
          searchCallMessage('call-chat', '{"q":"mira"}'),
          toolResultMessage('call-chat', '{"result":"ok"}'),
        ],
        tools: [searchTool],
      }),
    ));
    await collect(await client.streamMessages(
      request('memory', {
        messages: [
          { role: 'system', content: 'Consolidate memory.' },
          { role: 'user', content: 'Return JSON only.' },
        ],
      }),
    ));

    const consolidationInput =
      JSON.parse(consolidationXhr.requestBody ?? '{}').input;
    expect(consolidationInput).toEqual([
      { role: 'system', content: 'Consolidate memory.' },
      { role: 'user', content: 'Return JSON only.' },
    ]);
    expect(JSON.stringify(consolidationInput)).not.toContain('chat-reasoning');
    expect(JSON.stringify(consolidationInput)).not.toContain('call-chat');
  });

  it('drops a stale Responses continuation batch when canonical tool-call identity no longer matches', async () => {
    const reasoning = reasoningItem('rs-stale', 'stale-reasoning');
    const staleCall = functionCallItem(
      'fc-stale',
      'stale-call',
      '{"q":"old"}',
    );
    const firstXhr = new FakeXhr(
      sse(
        outputItemDone(0, reasoning),
        outputItemDone(1, staleCall),
        completedResponse([reasoning, staleCall]),
      ),
    );
    const secondXhr = new FakeXhr(sse(completedResponse([])));
    const client = createQueuedResponsesClient([firstXhr, secondXhr]);

    await collect(await client.streamMessages(
      request('old request', { tools: [searchTool] }),
    ));
    await collect(await client.streamMessages(
      request('replacement request', {
        messages: [
          { role: 'user', content: 'replacement request' },
          searchCallMessage('replacement-call', '{"q":"new"}'),
          toolResultMessage('replacement-call', '{"result":"new"}'),
        ],
      }),
    ));

    const secondInput = JSON.parse(secondXhr.requestBody ?? '{}').input;
    expect(secondInput).toEqual([
      { role: 'user', content: 'replacement request' },
      {
        type: 'function_call',
        call_id: 'replacement-call',
        name: 'search',
        arguments: '{"q":"new"}',
      },
      {
        type: 'function_call_output',
        call_id: 'replacement-call',
        output: '{"result":"new"}',
      },
    ]);
    expect(JSON.stringify(secondInput)).not.toContain('stale-reasoning');
    expect(JSON.stringify(secondInput)).not.toContain('stale-call');
  });
});
