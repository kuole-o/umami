import { z } from 'zod';
import { BROWSERS, EVENT_COLUMNS, OS_NAMES, SESSION_COLUMNS } from '@/lib/constants';
import { getCompareDate } from '@/lib/date';
import { getQueryFilters, parseRequest } from '@/lib/request';
import { badRequest, json, unauthorized } from '@/lib/response';
import { dateRangeParams, filterParams, searchParams } from '@/lib/schema';
import { canViewWebsite } from '@/permissions';
import { getPageviewMetrics, getSessionMetrics, getWebsiteStats } from '@/queries/sql';
import countryNames from '../../../../../../public/intl/country/zh-CN.json';

type DataItem = { x: string; y: number };
type NameMapping = Record<string, string>;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ websiteId: string }> },
) {
  // 1. 定义请求参数模式
  const schema = z.object({
    limit: z.coerce.number().optional(),
    offset: z.coerce.number().optional(),
    search: z.string().optional(),
    compare: z.enum(['true', 'false']).optional().default('false'),
    ...dateRangeParams,
    ...searchParams,
    ...filterParams,
  });

  // 2. 解析请求和验证权限
  const { auth, query, error } = await parseRequest(request, schema);
  if (error) return error();
  const { websiteId } = await params;
  if (!(await canViewWebsite(auth, websiteId))) return unauthorized();

  const { limit, offset, search, compare } = query;
  const baseFilters = await getQueryFilters(query, websiteId);
  const shouldCompare = compare === 'true';

  // 3. 获取并合并概览数据 (stats) 与对比数据
  let currentStats, compareStats;
  try {
    currentStats = await getWebsiteStats(websiteId, baseFilters);
    if (shouldCompare) {
      // 需要对比：获取上一周期数据并格式化对比结构
      const { startDate: compareStart, endDate: compareEnd } = getCompareDate(
        'prev',
        baseFilters.startDate,
        baseFilters.endDate,
      );
      compareStats = await getWebsiteStats(websiteId, {
        ...baseFilters,
        startDate: compareStart,
        endDate: compareEnd,
      });
    }
  } catch (error) {
    console.error('Error fetching website stats:', error);
    // 核心数据获取失败，整个接口返回错误
    return badRequest();
  }

  // 格式化为对比结构：{ value: 当前值, prev: 对比值 }
  let formattedStats = {};
  if (shouldCompare && compareStats) {
    formattedStats = Object.keys(currentStats).reduce(
      (acc, key) => {
        acc[key] = {
          value: Number(currentStats[key]) || 0,
          prev: Number(compareStats[key]) || 0,
        };
        return acc;
      },
      {} as Record<string, { value: number; prev: number }>,
    );
  } else {
    // 不需要对比：直接使用当前值
    formattedStats = Object.keys(currentStats).reduce(
      (acc, key) => {
        acc[key] = Number(currentStats[key]) || 0;
        return acc;
      },
      {} as Record<string, number>,
    );
  }

  // 4. 获取分类维度数据 (os, browser, country)
  const getDimensionData = async (type: string) => {
    // 准备查询过滤器
    const filters = { ...baseFilters };
    if (search) {
      filters[type] = `c.${search}`;
    }

    try {
      if (SESSION_COLUMNS.includes(type)) {
        let data = await getSessionMetrics(websiteId, { type, limit, offset }, filters);
        // 保留你对 language 的特殊处理逻辑
        if (type === 'language') {
          const combined: Record<string, DataItem> = {};
          for (const { x, y } of data) {
            const key = String(x).toLowerCase().split('-')[0];
            combined[key] = combined[key] || { x: key, y: 0 };
            combined[key].y += y;
          }
          data = Object.values(combined);
        }
        return data;
      }

      if (EVENT_COLUMNS.includes(type)) {
        return await getPageviewMetrics(websiteId, { type, limit, offset }, filters);
      }
    } catch (error) {
      // 单个维度查询失败，记录日志但返回空数组，不中断整个接口
      console.error(`Error fetching ${type} metrics:`, error);
    }
    return [];
  };

  // 并发获取三个维度的数据
  const [osData, browserData, countryData] = await Promise.all([
    getDimensionData('os'),
    getDimensionData('browser'),
    getDimensionData('country'),
  ]);

  // 5. 格式化数据（添加可读名称和图标）
  const formatData = (data: DataItem[], type: 'os' | 'browser' | 'country' | 'device') => {
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
      case 'device':
        // 注意：DEVICE_NAMES 常量可能需要从 '@/lib/constants' 导入
        iconBasePath = '//umami.guole.fun/images/device/';
        break;
      default:
        return data.map(item => ({ ...item, name: item.x, icon: '' }));
    }

    return data.map(item => {
      const itemName = item.x.toLowerCase().replace(/ /g, '-');
      return {
        x: item.x,
        y: item.y,
        name: nameMapping[item.x] || item.x,
        icon: iconBasePath ? `${iconBasePath}${itemName}.png` : '',
      };
    });
  };

  // 6. 组装最终响应
  const result = {
    stats: formattedStats,
    os: formatData(osData, 'os'),
    browser: formatData(browserData, 'browser'),
    country: formatData(countryData, 'country'),
  };

  return json(result);
}
