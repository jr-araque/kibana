/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { v4 as uuidv4 } from 'uuid';
import { transformError } from '@kbn/securitysolution-es-utils';
import { EXCEPTION_LIST_ITEMS_BULK_URL } from '@kbn/securitysolution-list-constants';
import { buildRouteValidationWithZod } from '@kbn/zod-helpers/v4';
import {
  BulkCreateExceptionListItemsRequestBody,
  BulkCreateExceptionListItemsResponse,
} from '@kbn/securitysolution-exceptions-common/api';
import { EXCEPTIONS_API_ALL } from '@kbn/security-solution-features/constants';
import type { ListsPluginRouter } from '../types';

import { buildSiemResponse } from './utils';
import { getExceptionListClient } from './utils/get_exception_list_client';

export const bulkCreateExceptionListItemsRoute = (router: ListsPluginRouter): void => {
  router.versioned
    .post({
      access: 'public',
      path: EXCEPTION_LIST_ITEMS_BULK_URL,
      security: {
        authz: {
          requiredPrivileges: [EXCEPTIONS_API_ALL],
        },
      },
    })
    .addVersion(
      {
        validate: {
          request: {
            body: buildRouteValidationWithZod(BulkCreateExceptionListItemsRequestBody),
          },
        },
        version: '2023-10-31',
      },
      async (context, request, response) => {
        const siemResponse = buildSiemResponse(response);
        try {
          const { list_id: listId, namespace_type: namespaceType, items } = request.body;

          const exceptionListsClient = await getExceptionListClient(context);

          const itemsWithIds = items.map((item) => ({
            comments: item.comments,
            description: item.description,
            entries: item.entries,
            expireTime: item.expire_time,
            itemId: item.item_id ?? uuidv4(),
            meta: item.meta,
            name: item.name,
            osTypes: item.os_types,
            tags: item.tags,
            type: item.type,
          }));

          const seen = new Set<string>();
          const deduplicatedItems = [];
          const duplicateErrors = [];

          for (const item of itemsWithIds) {
            if (seen.has(item.itemId)) {
              duplicateErrors.push({
                error: {
                  message: `Duplicate item_id: "${item.itemId}" found within the request`,
                  status_code: 409,
                },
                item_id: item.itemId,
                list_id: listId,
              });
            } else {
              seen.add(item.itemId);
              deduplicatedItems.push(item);
            }
          }

          const result = await exceptionListsClient.bulkCreateExceptionListItems({
            items: deduplicatedItems,
            listId,
            namespaceType,
          });

          const responseBody = {
            errors: [...duplicateErrors, ...result.errors],
            items: result.items,
          };

          return response.ok({
            body: BulkCreateExceptionListItemsResponse.parse(responseBody),
          });
        } catch (err) {
          const error = transformError(err);
          return siemResponse.error({
            body: error.message,
            statusCode: error.statusCode,
          });
        }
      }
    );
};
