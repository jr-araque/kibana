/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { z, lazySchema } from '@kbn/zod/v4';

import {
  ExceptionListItem,
  ExceptionListItemHumanId,
  ExceptionListItemType,
  ExceptionListItemName,
  ExceptionListItemDescription,
  ExceptionNamespaceType,
  ExceptionListItemMeta,
  ExceptionListItemExpireTime,
  ExceptionListHumanId,
  ExceptionListItemOsTypeArray,
  ExceptionListItemTags,
} from '../model/exception_list_common.gen';
import { ExceptionListItemEntryArray } from '../model/exception_list_item_entry.gen';
import { CreateExceptionListItemCommentArray } from '../create_exception_list_item/create_exception_list_item.gen';

export const BulkCreateExceptionListItemData = lazySchema(() =>
  z.object({
    item_id: ExceptionListItemHumanId.optional(),
    type: ExceptionListItemType,
    name: ExceptionListItemName,
    description: ExceptionListItemDescription,
    entries: ExceptionListItemEntryArray,
    os_types: ExceptionListItemOsTypeArray.optional().default([]),
    tags: ExceptionListItemTags.optional().default([]),
    meta: ExceptionListItemMeta.optional(),
    expire_time: ExceptionListItemExpireTime.optional(),
    comments: CreateExceptionListItemCommentArray.optional().default([]),
  })
);
export type BulkCreateExceptionListItemData = z.infer<typeof BulkCreateExceptionListItemData>;

export const BulkCreateExceptionListItemsRequestBody = lazySchema(() =>
  z.object({
    list_id: ExceptionListHumanId,
    namespace_type: ExceptionNamespaceType.optional().default('single'),
    items: z.array(BulkCreateExceptionListItemData).min(1),
  })
);
export type BulkCreateExceptionListItemsRequestBody = z.infer<
  typeof BulkCreateExceptionListItemsRequestBody
>;
export type BulkCreateExceptionListItemsRequestBodyInput = z.input<
  typeof BulkCreateExceptionListItemsRequestBody
>;

export const BulkCreateExceptionListItemsErrorItem = lazySchema(() =>
  z.object({
    item_id: z.string().optional(),
    list_id: z.string().optional(),
    error: z.object({
      message: z.string(),
      status_code: z.number().int(),
    }),
  })
);
export type BulkCreateExceptionListItemsErrorItem = z.infer<
  typeof BulkCreateExceptionListItemsErrorItem
>;

export const BulkCreateExceptionListItemsResponse = lazySchema(() =>
  z.object({
    items: z.array(ExceptionListItem),
    errors: z.array(BulkCreateExceptionListItemsErrorItem),
  })
);
export type BulkCreateExceptionListItemsResponse = z.infer<
  typeof BulkCreateExceptionListItemsResponse
>;
