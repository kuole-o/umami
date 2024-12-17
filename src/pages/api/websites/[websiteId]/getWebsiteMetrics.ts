import * as yup from 'yup';
import { NextApiResponse } from 'next';
import { methodNotAllowed, ok, unauthorized } from 'next-basics';
import { canViewWebsite } from 'lib/auth';
import { useAuth, useCors, useValidate } from 'lib/middleware';
import { NextApiRequestQueryBody } from 'lib/types';
import { getRequestFilters, getRequestDateRange } from 'lib/request';
import { getPageviewMetrics, getSessionMetrics, getWebsiteStats } from 'queries';
import {
  SESSION_COLUMNS,
  EVENT_COLUMNS,
  FILTER_COLUMNS,
  OPERATORS,
  OS_NAMES,
  BROWSERS,
} from 'lib/constants';
import { getCompareDate } from 'lib/date';

export interface CombinedMetricsRequestQuery {
  websiteId: string;
  startAt: number;
  endAt: number;
  limit?: number;
  offset?: number;
  search?: string;
  url?: string;
  referrer?: string;
  title?: string;
  query?: string;
  event?: string;
  host?: string;
  os?: string;
  browser?: string;
  device?: string;
  country?: string;
  region?: string;
  city?: string;
  tag?: string;
  compare?: string;
  type: string;
  language?: string;
}

const schema = {
  GET: yup.object().shape({
    websiteId: yup.string().uuid().required(),
    startAt: yup.number().required(),
    endAt: yup.number().required(),
    limit: yup.number(),
    offset: yup.number(),
    search: yup.string(),
    type: yup.string().required(),
    url: yup.string(),
    referrer: yup.string(),
    title: yup.string(),
    query: yup.string(),
    host: yup.string(),
    os: yup.string(),
    browser: yup.string(),
    device: yup.string(),
    country: yup.string(),
    region: yup.string(),
    city: yup.string(),
    language: yup.string(),
    event: yup.string(),
    tag: yup.string(),
    compare: yup.string(),
  }),
};

type dataType = ItemType[];

type SourceType = {
  [key: string]: string;
};

interface ItemType {
  x: string;
  y: number;
}

export default async (
  req: NextApiRequestQueryBody<CombinedMetricsRequestQuery>,
  res: NextApiResponse,
) => {
  await useCors(req, res);
  await useAuth(req, res);
  await useValidate(schema, req, res);

  const { websiteId, type, limit, offset, search, compare } = req.query;

  if (req.method === 'GET') {
    if (!(await canViewWebsite(req.auth, websiteId))) {
      return unauthorized(res);
    }

    const { startDate, endDate } = await getRequestDateRange(req);
    const { startDate: compareStartDate, endDate: compareEndDate } = getCompareDate(
      compare,
      startDate,
      endDate,
    );
    const column = FILTER_COLUMNS[type] || type;

    const filters = getRequestFilters(req);
    const filters_search = {
      ...getRequestFilters(req),
      startDate,
      endDate,
    };

    if (search) {
      filters_search[type] = {
        name: type,
        column,
        operator: OPERATORS.contains,
        value: search,
      };
    }

    // 获取访问统计数据
    const metrics = await getWebsiteStats(websiteId, {
      ...filters,
      startDate,
      endDate,
    });

    const prevPeriod = await getWebsiteStats(websiteId, {
      ...filters,
      startDate: compareStartDate,
      endDate: compareEndDate,
    });

    const stats = Object.keys(metrics[0]).reduce((obj, key) => {
      obj[key] = {
        value: Number(metrics[0][key]) || 0,
        prev: Number(prevPeriod[0][key]) || 0,
      };
      return obj;
    }, {});

    // 获取操作系统/浏览器/国家地区的统计数据
    const getMetricsData = async (websiteId, filters_search, limit, offset, types) => {
      if (SESSION_COLUMNS.includes(types)) {
        const data = await getSessionMetrics(websiteId, types, filters_search, limit, offset);
        // console.log("data：", data);
        if (types === 'language') {
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

      if (EVENT_COLUMNS.includes(types)) {
        const data = await getPageviewMetrics(websiteId, types, filters_search, limit, offset);
        return data;
      }

      return [];
    };

    const osData = await getMetricsData(websiteId, filters_search, limit, offset, 'os');
    const browserData = await getMetricsData(websiteId, filters_search, limit, offset, 'browser');
    const countryData = await getMetricsData(websiteId, filters_search, limit, offset, 'country');

    // console.log("stats：", stats);
    // console.log("osData：", osData);
    // console.log("browserData：", browserData);
    // console.log("countryData：", countryData);

    const formattedData = async (data: dataType, type: string) => {
      let source: SourceType;
      switch (type) {
        case 'os':
          source = OS_NAMES;
          break;
        case 'browser':
          source = BROWSERS;
          break;
      }
      if (source) {
        return data.map((item: ItemType) => ({
          x: source[item.x] || item.x,
          y: item.y,
        }));
      }
      return false;
    };

    // 返回合并的结果
    return ok(res, {
      os: (await formattedData(osData, 'os')) || osData || [],
      browser: (await formattedData(browserData, 'browser')) || browserData || [],
      country: (await formattedData(countryData, 'country')) || countryData || [],
      stats: stats || [],
    });
  }

  return methodNotAllowed(res);
};
