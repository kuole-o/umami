import { z } from 'zod';
import { filterParams, searchParams, withDateRange } from '@/lib/schema';

export const mainMetricsQuerySchema = withDateRange({
  limit: z.coerce.number().optional(),
  offset: z.coerce.number().optional(),
  compare: z.enum(['true', 'false', 'prev', 'yoy']).optional().default('false'),
  ...searchParams,
  ...filterParams,
}).meta({
  id: 'MainMetricsQuery',
  description:
    'Date range plus optional analytics filters. Set compare=true or compare=prev for the previous period, compare=yoy for the same period last year, or compare=false to omit comparison values.',
});

const mainMetricValueSchema = z.union([
  z.number(),
  z.object({
    value: z.number(),
    prev: z.number(),
  }),
]);

const mainMetricRowSchema = z.object({
  x: z.string(),
  y: z.number(),
  name: z.string(),
  icon: z.string(),
});

export const mainMetricsResponseSchema = z
  .object({
    stats: z.record(z.string(), mainMetricValueSchema),
    os: z.array(mainMetricRowSchema),
    browser: z.array(mainMetricRowSchema),
    country: z.array(mainMetricRowSchema),
  })
  .meta({ id: 'MainMetricsResponse' });
