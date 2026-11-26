import { validateToolArguments } from '@earendil-works/pi-ai';
import { ensureStructuredClone } from './structuredClone';

const originalClone = global.structuredClone;
const tool = {
  name: 'local_weather_current',
  description: 'Weather lookup',
  parameters: {
    type: 'object',
    properties: { city: { type: 'string' } },
    required: ['city'],
    additionalProperties: false,
  },
};
const invocation = {
  type: 'toolCall',
  id: 'qa-weather',
  name: 'local_weather_current',
  arguments: { city: 'Guangzhou' },
};

afterEach(() => {
  if (originalClone === undefined) {
    delete global.structuredClone;
  } else {
    global.structuredClone = originalClone;
  }
});

describe('Hermes structuredClone compatibility', () => {
  it('lets the real Pi argument validator run without a native clone API', () => {
    delete global.structuredClone;
    expect(typeof global.structuredClone).toBe('undefined');

    ensureStructuredClone();

    expect(validateToolArguments(tool, invocation)).toEqual({ city: 'Guangzhou' });
    const source = { city: 'Guangzhou', metadata: { days: 3 } };
    const copy = global.structuredClone(source);
    expect(copy).toEqual(source);
    expect(copy).not.toBe(source);
    expect(copy.metadata).not.toBe(source.metadata);
  });

  it('does not replace a native implementation', () => {
    const native = jest.fn(value => value);
    global.structuredClone = native;

    ensureStructuredClone();

    expect(global.structuredClone).toBe(native);
  });
});
