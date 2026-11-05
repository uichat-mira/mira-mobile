import { weatherToolDefinition } from './weatherTool';

const jsonResponse = (payload: unknown, status = 200): Response =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  }) as unknown as Response;

const locationPayload = {
  results: [
    {
      name: '上海',
      latitude: 31.2222,
      longitude: 121.4581,
      country: '中国',
      admin1: '上海市',
      timezone: 'Asia/Shanghai',
    },
  ],
};

const forecastPayload = {
  current: {
    time: '2026-11-05T10:00',
    temperature_2m: 18.64,
    apparent_temperature: 17.21,
    relative_humidity_2m: 72,
    weather_code: 2,
    wind_speed_10m: 12.34,
  },
  daily: {
    time: ['2026-11-05'],
    weather_code: [61],
    temperature_2m_max: [21.26],
    temperature_2m_min: [14.04],
    precipitation_probability_max: [65],
  },
};

describe('local weather tool', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('returns current weather and daily forecast for a city', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse(locationPayload))
      .mockResolvedValueOnce(jsonResponse(forecastPayload));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await weatherToolDefinition.call({ city: '上海' }, {});
    const payload = JSON.parse(result.content) as {
      location: { name: string };
      current: { condition: string; temperatureC: number };
      daily: Array<{ condition: string; maxC: number; minC: number }>;
    };

    expect(payload.location.name).toBe('上海');
    expect(payload.current).toMatchObject({
      condition: '多云',
      temperatureC: 18.6,
    });
    expect(payload.daily).toEqual([
      {
        date: '2026-11-05',
        condition: '小雨',
        maxC: 21.3,
        minC: 14,
        precipitationProbabilityPercent: 65,
      },
    ]);
    expect(fetchMock.mock.calls[0]?.[0]).toContain('geocoding-api');
    expect(fetchMock.mock.calls[1]?.[0]).toContain('api.open-meteo.com');
    expect(fetchMock.mock.calls[1]?.[0]).toContain('forecast_days=3');
  });

  it('reports an unknown city without calling the forecast API', async () => {
    // Open-Meteo omits `results` completely when the geocoding query has no
    // matches; treating that as an upstream error would hide a normal miss.
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse({ generationtime_ms: 0.2 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(
      weatherToolDefinition.call({ city: '不存在的城市' }, {}),
    ).rejects.toMatchObject({ code: 'WEATHER_CITY_NOT_FOUND' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('reports an unknown city when the geocoding result list is empty', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse({ results: [] }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(
      weatherToolDefinition.call({ city: '不存在的城市' }, {}),
    ).rejects.toMatchObject({ code: 'WEATHER_CITY_NOT_FOUND' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('validates the forecast day range before making a request', async () => {
    const fetchMock = jest.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(
      weatherToolDefinition.call({ city: '上海', days: 9 }, {}),
    ).rejects.toMatchObject({ code: 'WEATHER_ARGUMENTS_INVALID' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('surfaces upstream HTTP failures as retryable tool errors', async () => {
    globalThis.fetch = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse({}, 503)) as unknown as typeof fetch;

    await expect(
      weatherToolDefinition.call({ city: '上海' }, {}),
    ).rejects.toMatchObject({
      code: 'WEATHER_UPSTREAM_FAILED',
      retryable: true,
    });
  });

  it('times out a slow weather request', async () => {
    jest.useFakeTimers();
    globalThis.fetch = jest.fn(
      (_url: string, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new Error('aborted')),
          );
        }),
    ) as unknown as typeof fetch;

    const result = weatherToolDefinition
      .call({ city: '上海' }, {})
      .catch((error: unknown) => error);
    jest.advanceTimersByTime(10_000);
    await expect(result).resolves.toMatchObject({
      code: 'WEATHER_TIMEOUT',
      retryable: true,
    });
  });
});
