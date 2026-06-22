/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { transformError } from '@kbn/securitysolution-es-utils';
import {
  EXCEPTION_LIST_ITEMS_BULK_UPDATE_URL,
  MAX_EXCEPTION_BULK_UPDATE_LIST_SIZE,
} from '@kbn/securitysolution-list-constants';
import { buildRouteValidationWithZod } from '@kbn/zod-helpers/v4';
import type { ExceptionListItemEntryArray } from '@kbn/securitysolution-exceptions-common/api';
import {
  BulkUpdateExceptionListItemsRequestBody,
  BulkUpdateExceptionListItemsResponse,
} from '@kbn/securitysolution-exceptions-common/api';
import { EXCEPTIONS_API_ALL } from '@kbn/security-solution-features/constants';
import type { OsTypeArray } from '@kbn/securitysolution-io-ts-list-types';

import type { ListsPluginRouter } from '../types';
import type { UpdateExceptionListItemOptions } from '../services/exception_lists/exception_list_client_types';

import { buildSiemResponse } from './utils';
import { validateCommentsToUpdate } from './utils/validate_comments_to_update';

import { getExceptionListClient } from '.';

export const bulkUpdateExceptionListItemsRoute = (router: ListsPluginRouter): void => {
  router.versioned
    .put({
      access: 'public',
      path: EXCEPTION_LIST_ITEMS_BULK_UPDATE_URL,
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
            body: buildRouteValidationWithZod(BulkUpdateExceptionListItemsRequestBody),
          },
        },
        version: '2023-10-31',
      },
      async (context, request, response) => {
        const siemResponse = buildSiemResponse(response);
        try {
          const { items } = request.body;

          if (items.length > MAX_EXCEPTION_BULK_UPDATE_LIST_SIZE) {
            return siemResponse.error({
              body: `Cannot bulk update more than ${MAX_EXCEPTION_BULK_UPDATE_LIST_SIZE} exception list items per request`,
              statusCode: 400,
            });
          }

          const preValidationErrors: BulkUpdateExceptionListItemsResponse['errors'] = [];
          const validItems: UpdateExceptionListItemOptions[] = [];

          for (const item of items) {
            const itemId = item.item_id;
            const { id } = item;

            if (id == null && itemId == null) {
              preValidationErrors.push({
                error: { message: 'either id or item_id must be defined', status_code: 400 },
              });
            } else {
              const commentErrors = validateCommentsToUpdate(item.comments);
              if (commentErrors.length) {
                preValidationErrors.push({
                  error: { message: commentErrors.join(', '), status_code: 400 },
                  ...(id != null ? { id } : {}),
                  ...(itemId != null ? { item_id: itemId } : {}),
                });
              } else {
                validItems.push({
                  _version: item._version,
                  comments: item.comments ?? [],
                  description: item.description,
                  entries: item.entries as ExceptionListItemEntryArray,
                  expireTime: item.expire_time,
                  id,
                  itemId,
                  meta: item.meta,
                  name: item.name,
                  namespaceType: item.namespace_type ?? 'single',
                  osTypes: ((item as { os_types?: string[] }).os_types ?? []) as OsTypeArray,
                  tags: (item as { tags?: string[] }).tags,
                  type: item.type,
                });
              }
            }
          }

          const exceptionListsClient = await getExceptionListClient(context);
          const result = await exceptionListsClient.bulkUpdateExceptionListItems({
            items: validItems,
          });

          const responseBody = {
            errors: [...preValidationErrors, ...result.errors],
            items: result.items,
          };

          return response.ok({
            body: BulkUpdateExceptionListItemsResponse.parse(responseBody),
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
