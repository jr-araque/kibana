/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { SavedObjectsClientContract } from '@kbn/core/server';
import { v4 as uuidv4 } from 'uuid';
import type {
  CreateExceptionListItemSchema,
  ExceptionListItemSchema,
} from '@kbn/securitysolution-io-ts-list-types';
import type { SavedObjectType } from '@kbn/securitysolution-list-utils';
import { getSavedObjectType } from '@kbn/securitysolution-list-utils';

import type { ExceptionListSoSchema } from '../../schemas/saved_objects';

import { transformCreateCommentsToComments, transformSavedObjectToExceptionListItem } from './utils';

interface BulkCreateExceptionListItemsOptions {
  items: CreateExceptionListItemSchema[];
  savedObjectsClient: SavedObjectsClientContract;
  user: string;
}

interface BulkCreateExceptionListItemsResult {
  items: ExceptionListItemSchema[];
  errors: Array<{ item_id?: string; error: { message: string; status_code: number } }>;
}

export const bulkCreateExceptionListItems = async ({
  items,
  savedObjectsClient,
  user,
}: BulkCreateExceptionListItemsOptions): Promise<BulkCreateExceptionListItemsResult> => {
  const dateNow = new Date().toISOString();
  const formattedItems = items.map((item) => {
    const savedObjectType = getSavedObjectType({ namespaceType: item.namespace_type ?? 'single' });

    return {
      attributes: {
        comments: transformCreateCommentsToComments({ incomingComments: item.comments ?? [], user }),
        created_at: dateNow,
        created_by: user,
        description: item.description,
        entries: item.entries,
        expire_time: item.expire_time,
        immutable: undefined,
        item_id: item.item_id,
        list_id: item.list_id,
        list_type: 'item',
        meta: item.meta,
        name: item.name,
        os_types: item.os_types,
        tags: item.tags,
        tie_breaker_id: uuidv4(),
        type: item.type,
        updated_by: user,
        version: undefined,
      },
      type: savedObjectType,
    } as { attributes: ExceptionListSoSchema; type: SavedObjectType };
  });

  const { saved_objects: savedObjects } =
    await savedObjectsClient.bulkCreate<ExceptionListSoSchema>(formattedItems);

  const createdItems: ExceptionListItemSchema[] = [];
  const errors: BulkCreateExceptionListItemsResult['errors'] = [];

  for (let i = 0; i < savedObjects.length; i++) {
    const so = savedObjects[i];
    if (so.error != null) {
      errors.push({
        error: { message: so.error.message, status_code: so.error.statusCode ?? 500 },
        item_id: items[i].item_id,
      });
    } else {
      createdItems.push(transformSavedObjectToExceptionListItem({ savedObject: so }));
    }
  }

  return { errors, items: createdItems };
};
