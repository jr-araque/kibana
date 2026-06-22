/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { v4 as uuidv4 } from 'uuid';
import type { ElasticsearchClient } from '@kbn/core/server';
import type {
  ListItemSchema,
  MetaOrUndefined,
  RefreshWithWaitFor,
  Type,
} from '@kbn/securitysolution-io-ts-list-types';
import { encodeHitVersion } from '@kbn/securitysolution-es-utils';

import { transformListItemToElasticQuery } from '../utils';
import type { CreateEsBulkTypeSchema, IndexEsListItemSchema } from '../../schemas/elastic_query';

export interface BulkCreateListItemsOptions {
  dateNow?: string;
  esClient: ElasticsearchClient;
  listId: string;
  listItemIndex: string;
  meta: MetaOrUndefined;
  refresh?: RefreshWithWaitFor;
  type: Type;
  user: string;
  value: string[];
}

interface BulkItemError {
  error: { message: string; status_code: number };
  index: number;
  value: string;
}

export interface BulkCreateListItemsResult {
  created_count: number;
  error_count: number;
  error_items: BulkItemError[];
  errors: boolean;
  items: ListItemSchema[];
}

interface PendingItem {
  elasticBody: IndexEsListItemSchema;
  id: string;
  originalIndex: number;
  tieBreakerId: string;
  value: string;
}

export const bulkCreateListItems = async ({
  listId,
  type,
  value,
  esClient,
  listItemIndex,
  user,
  meta,
  dateNow,
  refresh = 'wait_for',
}: BulkCreateListItemsOptions): Promise<BulkCreateListItemsResult> => {
  if (!value.length) {
    return { created_count: 0, error_count: 0, error_items: [], errors: false, items: [] };
  }

  const createdAt = dateNow ?? new Date().toISOString();
  const transformErrors: BulkItemError[] = [];
  const pendingItems: PendingItem[] = [];
  const bulkBody: Array<IndexEsListItemSchema | CreateEsBulkTypeSchema> = [];

  for (let i = 0; i < value.length; i++) {
    const singleValue = value[i];
    const elasticQuery = transformListItemToElasticQuery({ type, value: singleValue });

    if (elasticQuery != null) {
      const id = uuidv4();
      const tieBreakerId = uuidv4();
      const elasticBody: IndexEsListItemSchema = {
        '@timestamp': createdAt,
        created_at: createdAt,
        created_by: user,
        list_id: listId,
        meta,
        tie_breaker_id: tieBreakerId,
        updated_at: createdAt,
        updated_by: user,
        ...elasticQuery,
      };

      pendingItems.push({ elasticBody, id, originalIndex: i, tieBreakerId, value: singleValue });
      bulkBody.push({ create: { _id: id, _index: listItemIndex } } as CreateEsBulkTypeSchema);
      bulkBody.push(elasticBody);
    } else {
      transformErrors.push({
        error: {
          message: `Unable to transform value "${singleValue}" for type "${type}"`,
          status_code: 400,
        },
        index: i,
        value: singleValue,
      });
    }
  }

  if (!pendingItems.length) {
    return {
      created_count: 0,
      error_count: transformErrors.length,
      error_items: transformErrors,
      errors: transformErrors.length > 0,
      items: [],
    };
  }

  const bulkResponse = await esClient.bulk({
    body: bulkBody,
    index: listItemIndex,
    refresh,
  });

  const items: ListItemSchema[] = [];
  const esErrors: BulkItemError[] = [];

  for (let i = 0; i < bulkResponse.items.length; i++) {
    const responseItem = bulkResponse.items[i].create;
    const pending = pendingItems[i];

    if (responseItem?.error) {
      esErrors.push({
        error: {
          message: responseItem.error.reason ?? 'Unknown Elasticsearch error',
          status_code: responseItem.status ?? 500,
        },
        index: pending.originalIndex,
        value: pending.value,
      });
    } else if (responseItem) {
      items.push({
        '@timestamp': createdAt,
        _version: encodeHitVersion(responseItem),
        created_at: createdAt,
        created_by: user,
        id: pending.id,
        list_id: listId,
        meta,
        tie_breaker_id: pending.tieBreakerId,
        type,
        updated_at: createdAt,
        updated_by: user,
        value: pending.value,
      });
    }
  }

  const allErrors = [...transformErrors, ...esErrors];

  return {
    created_count: items.length,
    error_count: allErrors.length,
    error_items: allErrors,
    errors: allErrors.length > 0,
    items,
  };
};
