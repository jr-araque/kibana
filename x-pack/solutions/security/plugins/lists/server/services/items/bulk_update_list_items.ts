/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { ElasticsearchClient } from '@kbn/core/server';
import type {
  ListItemSchema,
  MetaOrUndefined,
  RefreshWithWaitFor,
  _VersionOrUndefined,
} from '@kbn/securitysolution-io-ts-list-types';

import { updateListItem } from './update_list_item';

export interface BulkUpdateListItemInput {
  _version: _VersionOrUndefined;
  id: string;
  meta: MetaOrUndefined;
  value: string;
}

export interface BulkUpdateListItemsOptions {
  dateNow?: string;
  esClient: ElasticsearchClient;
  items: BulkUpdateListItemInput[];
  listItemIndex: string;
  refresh?: RefreshWithWaitFor;
  user: string;
}

interface BulkItemError {
  error: { message: string; status_code: number };
  id: string;
  index: number;
}

export interface BulkUpdateListItemsResult {
  error_count: number;
  error_items: BulkItemError[];
  errors: boolean;
  items: ListItemSchema[];
  updated_count: number;
}

export const bulkUpdateListItems = async ({
  items,
  esClient,
  listItemIndex,
  user,
  dateNow,
  refresh,
}: BulkUpdateListItemsOptions): Promise<BulkUpdateListItemsResult> => {
  if (!items.length) {
    return { error_count: 0, error_items: [], errors: false, items: [], updated_count: 0 };
  }

  const successItems: ListItemSchema[] = [];
  const errorItems: BulkItemError[] = [];

  const refreshBoolean = refresh === 'true' || refresh === 'wait_for' ? true : false;

  for (let i = 0; i < items.length; i++) {
    const { _version, id, meta, value } = items[i];
    try {
      const updated = await updateListItem({
        _version,
        dateNow,
        esClient,
        id,
        isPatch: false,
        listItemIndex,
        meta,
        refresh: refreshBoolean,
        user,
        value,
      });

      if (updated == null) {
        errorItems.push({
          error: { message: `list item id: "${id}" not found`, status_code: 404 },
          id,
          index: i,
        });
      } else {
        successItems.push(updated);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const statusCode = /version conflict/i.test(message) ? 409 : 500;
      errorItems.push({ error: { message, status_code: statusCode }, id, index: i });
    }
  }

  return {
    error_count: errorItems.length,
    error_items: errorItems,
    errors: errorItems.length > 0,
    items: successItems,
    updated_count: successItems.length,
  };
};
