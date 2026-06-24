/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { httpServerMock } from '@kbn/core/server/mocks';
import type { SavedObjectsFindResponse } from '@kbn/core/server';
import { SavedObjectsErrorHelpers } from '@kbn/core/server';

import { createExtensionPointStorageMock } from '../extension_points/extension_point_storage.mock';

import {
  getExceptionListSavedObjectClientMock,
  getUpdateExceptionListItemOptionsMock,
} from './exception_list_client.mock';
import { ExceptionListClient } from './exception_list_client';

describe('bulkUpdateExceptionListItems', () => {
  const createClient = (): {
    client: ExceptionListClient;
    savedObjectsClient: ReturnType<typeof getExceptionListSavedObjectClientMock>;
  } => {
    const extensionPointStorageContext = createExtensionPointStorageMock();
    const savedObjectsClient = getExceptionListSavedObjectClientMock();
    const client = new ExceptionListClient({
      enableServerExtensionPoints: false,
      request: httpServerMock.createKibanaRequest(),
      savedObjectsClient,
      serverExtensionsClient: extensionPointStorageContext.extensionPointStorage.getClient(),
      user: 'elastic',
    });
    return { client, savedObjectsClient };
  };

  it('should update all items successfully', async () => {
    const { client } = createClient();
    const item1 = { ...getUpdateExceptionListItemOptionsMock(), id: 'id-1', itemId: 'item-1' };
    const item2 = { ...getUpdateExceptionListItemOptionsMock(), id: 'id-2', itemId: 'item-2' };

    const result = await client.bulkUpdateExceptionListItems({ items: [item1, item2] });

    expect(result.items).toHaveLength(2);
    expect(result.errors).toHaveLength(0);
  });

  it('should return a 404 error when an item does not exist', async () => {
    const { client, savedObjectsClient } = createClient();

    const notFoundError = SavedObjectsErrorHelpers.createGenericNotFoundError(
      'exception-list',
      'id-2'
    );

    const origGet = savedObjectsClient.get.getMockImplementation();
    let getCallCount = 0;
    savedObjectsClient.get.mockImplementation(async (...args) => {
      getCallCount++;
      if (getCallCount === 2) {
        throw notFoundError;
      }
      if (origGet) {
        return origGet(...args);
      }
      throw new Error('No mock implementation');
    });

    const item1 = { ...getUpdateExceptionListItemOptionsMock(), id: 'id-1', itemId: 'item-1' };
    const item2 = { ...getUpdateExceptionListItemOptionsMock(), id: 'id-2', itemId: 'item-2' };

    const result = await client.bulkUpdateExceptionListItems({ items: [item1, item2] });

    expect(result.items).toHaveLength(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toEqual(
      expect.objectContaining({
        error: expect.objectContaining({
          status_code: 404,
        }),
        id: 'id-2',
        item_id: 'item-2',
      })
    );
  });

  it('should catch version conflict errors from savedObjectsClient.create', async () => {
    const { client, savedObjectsClient } = createClient();

    const conflictError = SavedObjectsErrorHelpers.createConflictError('exception-list', 'id-2');

    const origCreate = savedObjectsClient.create.getMockImplementation();
    let createCallCount = 0;
    savedObjectsClient.create.mockImplementation(async (...args) => {
      createCallCount++;
      if (createCallCount === 2) {
        throw conflictError;
      }
      if (origCreate) {
        return origCreate(...args);
      }
      throw new Error('No mock implementation');
    });

    const item1 = { ...getUpdateExceptionListItemOptionsMock(), id: 'id-1', itemId: 'item-1' };
    const item2 = { ...getUpdateExceptionListItemOptionsMock(), id: 'id-2', itemId: 'item-2' };

    const result = await client.bulkUpdateExceptionListItems({ items: [item1, item2] });

    expect(result.items).toHaveLength(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toEqual(
      expect.objectContaining({
        error: expect.objectContaining({
          status_code: 409,
        }),
        id: 'id-2',
        item_id: 'item-2',
      })
    );
  });

  it('should return empty results for an empty items array', async () => {
    const { client } = createClient();

    const result = await client.bulkUpdateExceptionListItems({ items: [] });

    expect(result.items).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
  });

  it('should include item_id but not id in error when only itemId is provided', async () => {
    const { client, savedObjectsClient } = createClient();

    savedObjectsClient.find.mockResolvedValueOnce({
      page: 1,
      per_page: 1,
      saved_objects: [],
      total: 0,
    } as unknown as SavedObjectsFindResponse);

    const item = {
      ...getUpdateExceptionListItemOptionsMock(),
      id: undefined,
      itemId: 'my-item-id',
    };

    const result = await client.bulkUpdateExceptionListItems({ items: [item] });

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].item_id).toBe('my-item-id');
    expect(result.errors[0].id).toBeUndefined();
  });

  it('should continue processing remaining items after an error', async () => {
    const { client, savedObjectsClient } = createClient();

    const notFoundError = SavedObjectsErrorHelpers.createGenericNotFoundError(
      'exception-list',
      'id-1'
    );

    const origGet = savedObjectsClient.get.getMockImplementation();
    let getCallCount = 0;
    savedObjectsClient.get.mockImplementation(async (...args) => {
      getCallCount++;
      if (getCallCount === 1) {
        throw notFoundError;
      }
      if (origGet) {
        return origGet(...args);
      }
      throw new Error('No mock implementation');
    });

    const item1 = { ...getUpdateExceptionListItemOptionsMock(), id: 'id-1', itemId: 'item-1' };
    const item2 = { ...getUpdateExceptionListItemOptionsMock(), id: 'id-2', itemId: 'item-2' };
    const item3 = { ...getUpdateExceptionListItemOptionsMock(), id: 'id-3', itemId: 'item-3' };

    const result = await client.bulkUpdateExceptionListItems({ items: [item1, item2, item3] });

    expect(result.items).toHaveLength(2);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].id).toBe('id-1');
  });
});
