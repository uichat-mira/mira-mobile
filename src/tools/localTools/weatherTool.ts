import type { LocalToolContext, LocalToolDefinition } from '../localToolGatewayClient';
import { ToolGatewayError } from '../toolGatewayClient';

const TOOL_NAME = 'local_weather_current';
const GEOCODING_ENDPOINT = 'https://geocoding-api.open-meteo.com/v1/search';
const FORECAST_ENDPOINT = 'https://api.open-meteo.com/v1/forecast';
const REQUEST_TIMEOUT_MS = 10_000;
const DEFAULT_FORECAST_DAYS = 3;
const MAX_FORECAST_DAYS = 7;

const WEATHER_CONDITIONS: Readonly<Record<number, string>> = {
  0: '晴',
  1: '大部晴朗',
  2: '多云',
  3: '阴',
  45: '雾',
  48: '雾凇',
  51: '小毛毛雨',
  53: '毛毛雨',
  55: '强毛毛雨',
  56: '冻毛毛雨',
  57: '强冻毛毛雨',
  61: '小雨',
  63: '中雨',
  65: '大雨',
  66: '冻雨',
  67: '强冻雨',
  71: '小雪',
  73: '中雪',
  75: '大雪',
  77: '雪粒',
  80: '小阵雨',
  81: '阵雨',
  82: '强阵雨',
  85: '小阵雪',
  86: '强阵雪',
  95: '雷暴',
  96: '雷暴伴小冰雹',
  99: '雷暴伴大冰雹',
};

interface Location {
  name: string;
  latitude: number;
  longitude: number;
  country?: string;
  admin1?: string;
  timezone?: string;
}

interface CurrentWeather {
  time: string;
  temperatureC: number;
  apparentTemperatureC: number;
  humidityPercent: number;
  windSpeedKmh: number;
  condition: string;
}

interface DailyWeather {
  date: string;
  condition: string;
  maxC: number;
  minC: number;
  precipitationProbabilityPercent?: number;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const readNonEmptyString = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

const readFiniteNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const round1 = (value: number): number => Math.round(value * 10) / 10;

const describeWeatherCode = (code: number): string =>
  WEATHER_CONDITIONS[code] ?? `未知天气(${code})`;

const fetchJson = async (
  url: string,
  signal?: AbortSignal,
): Promise<unknown> => {
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, REQUEST_TIMEOUT_MS);
  const abortFromCaller = () => controller.abort();

  if (signal?.aborted) {
    controller.abort();
  } else {
    signal?.addEventListener('abort', abortFromCaller, { once: true });
  }

  try {
    if (signal?.aborted) {
      throw new ToolGatewayError(
        'TOOL_CANCELLED',
        'Weather lookup was cancelled',
      );
    }
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) {
      throw new ToolGatewayError(
        'WEATHER_UPSTREAM_FAILED',
        `Weather service returned HTTP ${response.status}`,
        true,
      );
    }
    return (await response.json()) as unknown;
  } catch (error) {
    if (error instanceof ToolGatewayError) throw error;
    if (signal?.aborted) {
      throw new ToolGatewayError(
        'TOOL_CANCELLED',
        'Weather lookup was cancelled',
      );
    }
    if (timedOut) {
      throw new ToolGatewayError(
        'WEATHER_TIMEOUT',
        'Weather service did not respond in time',
        true,
      );
    }
    throw new ToolGatewayError(
      'WEATHER_UPSTREAM_FAILED',
      'Unable to reach the weather service',
      true,
    );
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abortFromCaller);
  }
};

const readForecastDays = (value: unknown): number => {
  if (value === undefined) return DEFAULT_FORECAST_DAYS;
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim()
        ? Number(value)
        : Number.NaN;
  if (
    !Number.isInteger(parsed) ||
    parsed < 1 ||
    parsed > MAX_FORECAST_DAYS
  ) {
    throw new ToolGatewayError(
      'WEATHER_ARGUMENTS_INVALID',
      `days must be an integer between 1 and ${MAX_FORECAST_DAYS}`,
    );
  }
  return parsed;
};

const lookupLocation = async (
  city: string,
  signal?: AbortSignal,
): Promise<Location | null> => {
  const url =
    `${GEOCODING_ENDPOINT}?name=${encodeURIComponent(city)}` +
    '&count=1&language=zh&format=json';
  const payload = await fetchJson(url, signal);
  if (!isRecord(payload) || !Array.isArray(payload.results)) {
    throw new ToolGatewayError(
      'WEATHER_UPSTREAM_FAILED',
      'Weather location response was invalid',
      true,
    );
  }

  const first = payload.results[0];
  if (first === undefined) return null;
  if (!isRecord(first)) {
    throw new ToolGatewayError(
      'WEATHER_UPSTREAM_FAILED',
      'Weather location response was invalid',
      true,
    );
  }

  const latitude = readFiniteNumber(first.latitude);
  const longitude = readFiniteNumber(first.longitude);
  if (latitude === null || longitude === null) {
    throw new ToolGatewayError(
      'WEATHER_UPSTREAM_FAILED',
      'Weather location response did not include coordinates',
      true,
    );
  }

  const name = readNonEmptyString(first.name) ?? city;
  const country = readNonEmptyString(first.country);
  const admin1 = readNonEmptyString(first.admin1);
  const timezone = readNonEmptyString(first.timezone);
  return {
    name,
    latitude,
    longitude,
    ...(country ? { country } : {}),
    ...(admin1 ? { admin1 } : {}),
    ...(timezone ? { timezone } : {}),
  };
};

const parseCurrentWeather = (value: unknown): CurrentWeather => {
  if (!isRecord(value)) {
    throw new ToolGatewayError(
      'WEATHER_UPSTREAM_FAILED',
      'Current weather response was invalid',
      true,
    );
  }
  const time = readNonEmptyString(value.time);
  const temperatureC = readFiniteNumber(value.temperature_2m);
  const apparentTemperatureC = readFiniteNumber(value.apparent_temperature);
  const humidityPercent = readFiniteNumber(value.relative_humidity_2m);
  const windSpeedKmh = readFiniteNumber(value.wind_speed_10m);
  const weatherCode = readFiniteNumber(value.weather_code);
  if (
    time === null ||
    temperatureC === null ||
    apparentTemperatureC === null ||
    humidityPercent === null ||
    windSpeedKmh === null ||
    weatherCode === null
  ) {
    throw new ToolGatewayError(
      'WEATHER_UPSTREAM_FAILED',
      'Current weather response was incomplete',
      true,
    );
  }
  return {
    time,
    temperatureC: round1(temperatureC),
    apparentTemperatureC: round1(apparentTemperatureC),
    humidityPercent: round1(humidityPercent),
    windSpeedKmh: round1(windSpeedKmh),
    condition: describeWeatherCode(weatherCode),
  };
};

const parseDailyWeather = (value: unknown): DailyWeather[] => {
  if (!isRecord(value)) return [];
  const dates = value.time;
  const codes = value.weather_code;
  const maxTemperatures = value.temperature_2m_max;
  const minTemperatures = value.temperature_2m_min;
  const precipitation = value.precipitation_probability_max;
  if (
    !Array.isArray(dates) ||
    !Array.isArray(codes) ||
    !Array.isArray(maxTemperatures) ||
    !Array.isArray(minTemperatures)
  ) {
    return [];
  }

  const daily: DailyWeather[] = [];
  for (let index = 0; index < dates.length; index += 1) {
    const date = readNonEmptyString(dates[index]);
    const code = readFiniteNumber(codes[index]);
    const maxC = readFiniteNumber(maxTemperatures[index]);
    const minC = readFiniteNumber(minTemperatures[index]);
    if (date === null || code === null || maxC === null || minC === null) {
      continue;
    }
    const precipitationProbabilityPercent = Array.isArray(precipitation)
      ? readFiniteNumber(precipitation[index])
      : null;
    daily.push({
      date,
      condition: describeWeatherCode(code),
      maxC: round1(maxC),
      minC: round1(minC),
      ...(precipitationProbabilityPercent !== null
        ? { precipitationProbabilityPercent }
        : {}),
    });
  }
  return daily;
};

const queryWeather = async (
  args: Record<string, unknown>,
  context: LocalToolContext,
): Promise<{ content: string }> => {
  const city = readNonEmptyString(args.city);
  if (!city) {
    throw new ToolGatewayError(
      'WEATHER_ARGUMENTS_INVALID',
      'city is required',
      false,
      '请提供城市名，例如“上海”',
    );
  }
  if (city.length > 80) {
    throw new ToolGatewayError(
      'WEATHER_ARGUMENTS_INVALID',
      'city is too long',
    );
  }
  const days = readForecastDays(args.days);

  const location = await lookupLocation(city, context.signal);
  if (!location) {
    throw new ToolGatewayError(
      'WEATHER_CITY_NOT_FOUND',
      `No weather location found for "${city}"`,
      false,
      '请提供更具体的城市名，例如“上海”',
    );
  }

  const forecastUrl =
    `${FORECAST_ENDPOINT}?latitude=${location.latitude}` +
    `&longitude=${location.longitude}` +
    '&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m' +
    '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max' +
    `&forecast_days=${days}&timezone=auto`;
  const forecast = await fetchJson(forecastUrl, context.signal);
  if (!isRecord(forecast)) {
    throw new ToolGatewayError(
      'WEATHER_UPSTREAM_FAILED',
      'Weather forecast response was invalid',
      true,
    );
  }

  const current = parseCurrentWeather(forecast.current);
  const daily = parseDailyWeather(forecast.daily);
  if (daily.length === 0) {
    throw new ToolGatewayError(
      'WEATHER_UPSTREAM_FAILED',
      'Weather forecast response did not include daily data',
      true,
    );
  }

  return {
    content: JSON.stringify({
      location,
      current,
      daily,
      source: 'Open-Meteo',
    }),
  };
};

export const weatherToolDefinition: LocalToolDefinition = {
  manifest: {
    name: TOOL_NAME,
    description:
      '查询指定城市的当前天气和未来 1-7 天预报。' +
      '只把城市名发送给 Open-Meteo，不需要定位权限或 API Key。',
    parameters: {
      type: 'object',
      properties: {
        city: {
          type: 'string',
          description: '城市名，例如“上海”或“Shanghai”',
        },
        days: {
          type: 'integer',
          minimum: 1,
          maximum: MAX_FORECAST_DAYS,
          description: `预报天数，默认 ${DEFAULT_FORECAST_DAYS} 天`,
        },
      },
      required: ['city'],
      additionalProperties: false,
    },
    destructive: false,
    requiresApproval: false,
  },
  call: queryWeather,
};
