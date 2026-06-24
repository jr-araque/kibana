/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { savedObjectsClientMock } from '@kbn/core/server/mocks';
import { SavedObjectsErrorHelpers } from '@kbn/core/server';

import { ENTRIES } from '../../../common/constants.mock';

import {
  getExceptionListSavedObjectClientMock,
  getExceptionListSoSchemaMock,
} from './exception_list_client.mock';
import { ExceptionListClient } from './exception_list_client';

describe('ExceptionListClient.bulkCreateExceptionListItems', () => {
  let savedObjectsClient: ReturnType<typeof savedObjectsClientMock.create>;
  let client: ExceptionListClient;

  const makeItem = (index: number) => ({
    comments: [],
    description: `item ${index}`,
    entries: ENTRIES,
    expireTime: undefined,
    itemId: `item-id-${index}`,
    meta: undefined,
    name: `Item ${index}`,
    osTypes: [] as never[],
    tags: [],
    type: 'simple' as const,
  });

  beforeEach(() => {
    savedObjectsClient = getExceptionListSavedObjectClientMock();
    client = new ExceptionListClient({
      savedObjectsClient,
      serverExtensionsClient: undefined as never,
      user: 'elastic',
    });
  });

  it('should throw if the parent exception list does not exist', async () => {
    savedObjectsClient.find.mockResolvedValueOnce({
      page: 1,
      per_page: 0,
      saved_objects: [],
      total: 0,
    } as never);

    await expect(
      client.bulkCreateExceptionListItems({
        items: [makeItem(1)],
        listId: 'non-existent-list',
        namespaceType: 'single',
      })
    ).rejects.toThrow();
  });

  it('should create items and return them', async () => {
    const soMock = getExceptionListSoSchemaMock({ item_id: 'item-id-1', name: 'Item 1' });
    savedObjectsClient.bulkCreate.mockResolvedValueOnce({
      saved_objects: [
        {
          attributes: soMock,
          id: 'so-id-1',
          references: [],
          type: 'exception-list',
          updated_at: '2020-04-20T15:25:31.830Z',
          version: 'WzI5NywxXQ==',
        },
      ],
    });

    const result = await client.bulkCreateExceptionListItems({
      items: [makeItem(1)],
      listId: 'some-list-id',
      namespaceType: 'single',
    });

    expect(result.items).toHaveLength(1);
    expect(result.errors).toHaveLength(0);
    expect(savedObjectsClient.bulkCreate).toHaveBeenCalledTimes(1);
  });

  it('should accumulate errors when bulkCreate throws', async () => {
    savedObjectsClient.bulkCreate.mockRejectedValueOnce(
      SavedObjectsErrorHelpers.decorateGeneralError(new Error('SO write failure'))
    );

    const items = [makeItem(1), makeItem(2)];
    const result = await client.bulkCreateExceptionListItems({
      items,
      listId: 'some-list-id',
      namespaceType: 'single',
    });

    expect(result.items).toHaveLength(0);
    expect(result.errors).toHaveLength(2);
    expect(result.errors[0].item_id).toBe('item-id-1');
    expect(result.errors[1].item_id).toBe('item-id-2');
  });

  it('should chunk items and call bulkCreate per chunk', async () => {
    const itemCount = 1500;
    const items = Array.from({ length: itemCount }, (_, i) => makeItem(i));

    const soMock = getExceptionListSoSchemaMock();
    savedObjectsClient.bulkCreate.mockImplementation(async (objects) => ({
      saved_objects: (objects as unknown[]).map((_, i) => ({
        attributes: { ...soMock, item_id: `item-id-${i}` },
        id: `so-id-${i}`,
        references: [],
        type: 'exception-list',
        updated_at: '2020-04-20T15:25:31.830Z',
        version: 'WzI5NywxXQ==',
      })),
    }));

    const result = await client.bulkCreateExceptionListItems({
      items,
      listId: 'some-list-id',
      namespaceType: 'single',
    });

    expect(savedObjectsClient.bulkCreate).toHaveBeenCalledTimes(2);
    const firstCallArgs = savedObjectsClient.bulkCreate.mock.calls[0][0] as unknown[];
    const secondCallArgs = savedObjectsClient.bulkCreate.mock.calls[1][0] as unknown[];
    expect(firstCallArgs).toHaveLength(1000);
    expect(secondCallArgs).toHaveLength(500);
    expect(result.items).toHaveLength(itemCount);
    expect(result.errors).toHaveLength(0);
  });

  it('should continue processing chunks after a chunk fails', async () => {
    const itemCount = 1500;
    const items = Array.from({ length: itemCount }, (_, i) => makeItem(i));

    const soMock = getExceptionListSoSchemaMock();

    savedObjectsClient.bulkCreate
      .mockRejectedValueOnce(new Error('First chunk failed'))
      .mockResolvedValueOnce({
        saved_objects: Array.from({ length: 500 }, (_, i) => ({
          attributes: { ...soMock, item_id: `item-id-${1000 + i}` },
          id: `so-id-${1000 + i}`,
          references: [],
          type: 'exception-list',
          updated_at: '2020-04-20T15:25:31.830Z',
          version: 'WzI5NywxXQ==',
        })),
      });

    const result = await client.bulkCreateExceptionListItems({
      items,
      listId: 'some-list-id',
      namespaceType: 'single',
    });

    expect(result.errors).toHaveLength(1000);
    expect(result.items).toHaveLength(500);
  });

  it('should map items with correct list_id and namespace_type', async () => {
    const soMock = getExceptionListSoSchemaMock();
    savedObjectsClient.bulkCreate.mockResolvedValueOnce({
      saved_objects: [
        {
          attributes: soMock,
          id: 'so-id-1',
          references: [],
          type: 'exception-list',
          updated_at: '2020-04-20T15:25:31.830Z',
          version: 'WzI5NywxXQ==',
        },
      ],
    });

    await client.bulkCreateExceptionListItems({
      items: [makeItem(1)],
      listId: 'my-list',
      namespaceType: 'single',
    });

    const bulkCreateArgs = savedObjectsClient.bulkCreate.mock.calls[0][0] as Array<{
      attributes: { list_id: string; name: string };
    }>;
    expect(bulkCreateArgs[0].attributes.list_id).toBe('my-list');
    expect(bulkCreateArgs[0].attributes.name).toBe('Item 1');
  });
});
