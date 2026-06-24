/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { z, lazySchema } from '@kbn/zod/v4';

import { ExceptionListItem } from '../model/exception_list_common.gen';
import { UpdateExceptionListItemRequestBody } from '../update_exception_list_item/update_exception_list_item.gen';

export const BulkUpdateExceptionListItemsRequestBody = lazySchema(() =>
  z.object({
    items: z.array(UpdateExceptionListItemRequestBody).min(1).max(1000),
  })
);
export type BulkUpdateExceptionListItemsRequestBody = z.infer<
  typeof BulkUpdateExceptionListItemsRequestBody
>;
export type BulkUpdateExceptionListItemsRequestBodyInput = z.input<
  typeof BulkUpdateExceptionListItemsRequestBody
>;

export const BulkUpdateExceptionListItemsErrorItem = lazySchema(() =>
  z.object({
    item_id: z.string().optional(),
    id: z.string().optional(),
    error: z.object({
      message: z.string(),
      status_code: z.number().int(),
    }),
  })
);
export type BulkUpdateExceptionListItemsErrorItem = z.infer<
  typeof BulkUpdateExceptionListItemsErrorItem
>;

export const BulkUpdateExceptionListItemsSummary = lazySchema(() =>
  z.object({
    succeeded: z.number().int(),
    failed: z.number().int(),
    total: z.number().int(),
  })
);
export type BulkUpdateExceptionListItemsSummary = z.infer<
  typeof BulkUpdateExceptionListItemsSummary
>;

export const BulkUpdateExceptionListItemsResponse = lazySchema(() =>
  z.object({
    items: z.array(ExceptionListItem),
    errors: z.array(BulkUpdateExceptionListItemsErrorItem),
    summary: BulkUpdateExceptionListItemsSummary,
  })
);
export type BulkUpdateExceptionListItemsResponse = z.infer<
  typeof BulkUpdateExceptionListItemsResponse
>;
