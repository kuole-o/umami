import { defineOperation } from '@/openapi/operation';
import { badRequestResponse, jsonResponse, unauthorizedResponse } from '@/openapi/schemas';
import { websiteIdPathSchema } from '../../response-schema';
import { mainMetricsQuerySchema, mainMetricsResponseSchema } from './schema';

const getWebsiteMainMetricsOperation = defineOperation({
  method: 'get',
  path: '/api/websites/{websiteId}/main-metrics',
  audience: 'public',
  auth: 'bearer-or-share',
  operation: {
    operationId: 'getWebsiteMainMetrics',
    summary: 'Get combined website headline metrics',
    description:
      'Returns summary statistics together with ranked operating system, browser, and country metrics. Human-readable names and icon URLs are included for each ranked item.',
    tags: ['Websites'],
    requestParams: {
      path: websiteIdPathSchema,
      query: mainMetricsQuerySchema,
    },
    responses: {
      '200': jsonResponse(mainMetricsResponseSchema, 'Combined website headline metrics.'),
      '400': badRequestResponse,
      '401': unauthorizedResponse,
    },
  },
});

export const operations = [getWebsiteMainMetricsOperation] as const;
