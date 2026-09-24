import { BROWSERS, OS_NAMES } from '@/lib/constants';
import { getCompareDate } from '@/lib/date';
import { getQueryFilters, parseRequest } from '@/lib/request';
import { badRequest, json, unauthorized } from '@/lib/response';
import { canViewWebsiteSection } from '@/permissions';
import { getSessionMetrics, getWebsiteStats } from '@/queries/sql';
import countryNames from '../../../../../../public/intl/country/zh-CN.json';
import { mainMetricsQuerySchema } from './schema';

type DataItem = { x: string; y: number };
type Dimension = 'os' | 'browser' | 'country';
type NameMapping = Record<string, string>;
type StatsData = Record<string, unknown>;

function formatStats(current: StatsData, comparison?: StatsData) {
  return Object.fromEntries(
    Object.entries(current).map(([key, value]) => [
      key,
      comparison
        ? { value: Number(value) || 0, prev: Number(comparison[key]) || 0 }
        : Number(value) || 0,
    ]),
  );
}

function formatData(data: DataItem[], type: Dimension) {
  let nameMapping: NameMapping = {};
  let iconBasePath = '';

  switch (type) {
    case 'os':
      nameMapping = OS_NAMES;
      iconBasePath = '//umami.guole.fun/images/os/';
      break;
    case 'browser':
      nameMapping = BROWSERS;
      iconBasePath = '//umami.guole.fun/images/browser/';
      break;
    case 'country':
      nameMapping = countryNames;
      iconBasePath = '//umami.guole.fun/images/country/';
      break;
  }

  return data.map(item => {
    const key = String(item.x);
    const iconName = key.toLowerCase().replace(/ /g, '-');

    return {
      x: item.x,
      y: item.y,
      name: nameMapping[key] || key,
      icon: `${iconBasePath}${iconName}.png`,
    };
  });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ websiteId: string }> },
) {
  const { auth, query, error } = await parseRequest(request, mainMetricsQuerySchema);

  if (error) {
    return error();
  }

  const { websiteId } = await params;

  if (!(await canViewWebsiteSection(auth, websiteId, ['overview', 'compare']))) {
    return unauthorized();
  }

  const { limit, offset, search, compare } = query;
  const baseFilters = await getQueryFilters(query, websiteId);
  const compareMode = compare === 'true' ? 'prev' : compare;
  const shouldCompare = compareMode === 'prev' || compareMode === 'yoy';

  let currentStats: StatsData;
  let compareStats: StatsData | undefined;
  try {
    const comparisonDates = shouldCompare
      ? getCompareDate(compareMode, baseFilters.startDate, baseFilters.endDate)
      : undefined;
    const [current, comparison] = await Promise.all([
      getWebsiteStats(websiteId, baseFilters),
      comparisonDates
        ? getWebsiteStats(websiteId, { ...baseFilters, ...comparisonDates })
        : Promise.resolve(undefined),
    ]);

    currentStats = (current ?? {}) as unknown as StatsData;
    compareStats = comparison as unknown as StatsData | undefined;
  } catch {
    return badRequest();
  }

  const getDimensionData = async (type: Dimension): Promise<DataItem[]> => {
    const filters = { ...baseFilters };

    if (search) {
      filters[type] = `c.${search}`;
    }

    try {
      return await getSessionMetrics(websiteId, { type, limit, offset }, filters);
    } catch {
      return [];
    }
  };

  const [osData, browserData, countryData] = await Promise.all([
    getDimensionData('os'),
    getDimensionData('browser'),
    getDimensionData('country'),
  ]);

  return json({
    stats: formatStats(currentStats, compareStats),
    os: formatData(osData, 'os'),
    browser: formatData(browserData, 'browser'),
    country: formatData(countryData, 'country'),
  });
}
