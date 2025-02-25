import { z } from 'zod';
import { canViewWebsite } from '@/lib/auth';
import { getCompareDate } from '@/lib/date';
import {
  SESSION_COLUMNS,
  EVENT_COLUMNS,
  FILTER_COLUMNS,
  OPERATORS,
  OS_NAMES,
  BROWSERS,
} from '@/lib/constants';
import { getRequestFilters, getRequestDateRange, parseRequest } from '@/lib/request';
import { json, unauthorized, badRequest } from '@/lib/response';
import { getPageviewMetrics, getSessionMetrics, getWebsiteStats } from '@/queries';
import { filterParams } from '@/lib/schema';
import countryNames from 'public/intl/country/zh-CN.json';

type dataType = ItemType[];
type SourceType = {
  [key: string]: string;
};
interface ItemType {
  x: string;
  y: number;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ websiteId: string }> },
) {
  const schema = z.object({
    type: z.string(),
    startAt: z.coerce.number().int(),
    endAt: z.coerce.number().int(),
    compare: z.string().optional(),
    limit: z.coerce.number().optional(),
    offset: z.coerce.number().optional(),
    search: z.string().optional(),
    ...filterParams,
  });

  const { auth, query, error } = await parseRequest(request, schema);

  if (error) {
    return error();
  }

  const { websiteId } = await params;
  const { type, limit, offset, search, compare } = query;

  if (!(await canViewWebsite(auth, websiteId))) {
    return unauthorized();
  }

  const { startDate, endDate } = await getRequestDateRange(query);
  const { startDate: compareStartDate, endDate: compareEndDate } = getCompareDate(
    compare,
    startDate,
    endDate,
  );

  const column = FILTER_COLUMNS[type] || type;

  const filters = getRequestFilters(query);
  const filters_search = {
    ...filters,
    startDate,
    endDate,
  };

  // 获取访问统计概览数据
  const metrics = await getWebsiteStats(websiteId, {
    ...filters,
    startDate,
    endDate,
  }).catch(() => {
    return badRequest();
  });
  // 获取上一期概览数据
  const prevPeriod = await getWebsiteStats(websiteId, {
    ...filters,
    startDate: compareStartDate,
    endDate: compareEndDate,
  }).catch(() => {
    return badRequest();
  });
  // 合并对比的概览数据
  const stats = Object.keys(metrics[0]).reduce((obj, key) => {
    obj[key] = {
      value: Number(metrics[0][key]) || 0,
      prev: Number(prevPeriod[0][key]) || 0,
    };
    return obj;
  }, {});

  if (search) {
    filters_search[type] = {
      name: type,
      column,
      operator: OPERATORS.contains,
      value: search,
    };
  }

  // 获取操作系统/浏览器/国家地区的统计数据
  const getMetricsData = async (websiteId, filters_search, limit, offset, type) => {
    if (SESSION_COLUMNS.includes(type)) {
      const data = await getSessionMetrics(websiteId, type, filters_search, limit, offset).catch(
        () => {
          return badRequest();
        },
      );
      // console.log("data：", data);
      if (type === 'language') {
        const combined = {};
        for (const { x, y } of data) {
          const key = String(x).toLowerCase().split('-')[0];
          if (combined[key] === undefined) {
            combined[key] = { x: key, y };
          } else {
            combined[key].y += y;
          }
        }
        return Object.values(combined);
      }
      return data;
    }

    if (EVENT_COLUMNS.includes(type)) {
      const data = await getPageviewMetrics(websiteId, type, filters_search, limit, offset).catch(
        () => {
          return badRequest();
        },
      );
      return data;
    }

    return [];
  };

  const osData = await getMetricsData(websiteId, filters_search, limit, offset, 'os');
  const browserData = await getMetricsData(websiteId, filters_search, limit, offset, 'browser');
  const countryData = await getMetricsData(websiteId, filters_search, limit, offset, 'country');

  const formattedData = async (data: dataType, type: string) => {
    let source: SourceType;
    let icon: string | undefined;
    switch (type) {
      case 'os':
        source = OS_NAMES;
        break;
      case 'browser':
        source = BROWSERS;
        break;
      case 'country':
        source = countryNames;
        break;
    }
    if (source) {
      return data.map((item: ItemType) => {
        const itemName: string = item.x.toLowerCase().replace(/ /g, '-');
        switch (type) {
          case 'os':
            icon = `//umami.guole.fun/images/os/${itemName}.png`;
            break;
          case 'browser':
            icon = `//umami.guole.fun/images/browser/${itemName}.png`;
            break;
          case 'country':
            icon = `//umami.guole.fun/images/country/${itemName}.png`;
            break;
          case 'device':
            icon = `//umami.guole.fun/images/device/${itemName}.png`;
            break;
          default:
            icon = '';
            break;
        }
        return {
          name: source[item.x] || item.x,
          icon: icon,
          x: item.x,
          y: item.y,
        };
      });
    }
    return [];
  };

  // 返回合并的结果
  return json({
    os: (await formattedData(osData, 'os')) || [],
    browser: (await formattedData(browserData, 'browser')) || [],
    country: (await formattedData(countryData, 'country')) || [],
    stats: stats || [],
  });
}
