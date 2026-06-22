/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { transformError } from '@kbn/securitysolution-es-utils';
import { LIST_ITEM_BULK_URL } from '@kbn/securitysolution-list-constants';
import { buildRouteValidationWithZod } from '@kbn/zod-helpers/v4';
import {
  BulkCreateListItemsRequestBody,
  BulkCreateListItemsResponse,
} from '@kbn/securitysolution-lists-common/api';
import { LISTS_API_ALL } from '@kbn/security-solution-features/constants';

import type { ListsPluginRouter } from '../../types';
import { buildSiemResponse } from '../utils';
import { getListClient } from '..';

export const bulkCreateListItemRoute = (router: ListsPluginRouter): void => {
  router.versioned
    .post({
      access: 'public',
      path: LIST_ITEM_BULK_URL,
      security: {
        authz: {
          requiredPrivileges: [LISTS_API_ALL],
        },
      },
    })
    .addVersion(
      {
        validate: {
          request: {
            body: buildRouteValidationWithZod(BulkCreateListItemsRequestBody),
          },
        },
        version: '2023-10-31',
      },
      async (context, request, response) => {
        const siemResponse = buildSiemResponse(response);
        try {
          const { list_id: listId, value, meta, refresh } = request.body;
          const lists = await getListClient(context);
          const list = await lists.getList({ id: listId });

          if (list == null) {
            return siemResponse.error({
              body: `list id: "${listId}" does not exist`,
              statusCode: 404,
            });
          }

          const result = await lists.bulkCreateListItems({
            listId,
            meta,
            refresh,
            type: list.type,
            value,
          });

          return response.ok({ body: BulkCreateListItemsResponse.parse(result) });
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
