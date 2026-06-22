/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { elasticsearchClientMock } from '@kbn/core-elasticsearch-client-server-mocks';

import {
  DATE_NOW,
  LIST_ITEM_ID,
  LIST_ITEM_INDEX,
  META,
  USER,
  VALUE,
  VALUE_2,
} from '../../../common/constants.mock';
import { getListItemResponseMock } from '../../../common/schemas/response/list_item_schema.mock';

import type { BulkUpdateListItemsOptions } from './bulk_update_list_items';
import { bulkUpdateListItems } from './bulk_update_list_items';
import * as updateListItemModule from './update_list_item';

const LIST_ITEM_ID_2 = 'some-list-item-id-2';

const getOptions = (
  overrides: Partial<BulkUpdateListItemsOptions> = {}
): BulkUpdateListItemsOptions => ({
  dateNow: DATE_NOW,
  esClient: elasticsearchClientMock.createScopedClusterClient().asCurrentUser,
  items: [
    { _version: undefined, id: LIST_ITEM_ID, meta: META, value: VALUE },
    { _version: undefined, id: LIST_ITEM_ID_2, meta: META, value: VALUE_2 },
  ],
  listItemIndex: LIST_ITEM_INDEX,
  user: USER,
  ...overrides,
});

describe('bulk_update_list_items', () => {
  let updateListItemSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    updateListItemSpy = jest
      .spyOn(updateListItemModule, 'updateListItem')
      .mockResolvedValue(getListItemResponseMock());
  });

  test('returns empty result for empty items array', async () => {
    const options = getOptions({ items: [] });
    const result = await bulkUpdateListItems(options);

    expect(result).toEqual({
      error_count: 0,
      error_items: [],
      errors: false,
      items: [],
      updated_count: 0,
    });
    expect(updateListItemSpy).not.toHaveBeenCalled();
  });

  test('returns updated items on full success', async () => {
    const itemMock = getListItemResponseMock();
    updateListItemSpy.mockResolvedValue(itemMock);

    const result = await bulkUpdateListItems(getOptions());

    expect(result.errors).toBe(false);
    expect(result.updated_count).toBe(2);
    expect(result.error_count).toBe(0);
    expect(result.items).toHaveLength(2);
    expect(result.error_items).toHaveLength(0);
    expect(updateListItemSpy).toHaveBeenCalledTimes(2);
  });

  test('adds not-found error when updateListItem returns null', async () => {
    updateListItemSpy
      .mockResolvedValueOnce(getListItemResponseMock())
      .mockResolvedValueOnce(null);

    const result = await bulkUpdateListItems(getOptions());

    expect(result.errors).toBe(true);
    expect(result.updated_count).toBe(1);
    expect(result.error_count).toBe(1);
    expect(result.items).toHaveLength(1);
    expect(result.error_items).toHaveLength(1);
    expect(result.error_items[0]).toEqual({
      error: { message: `list item id: "${LIST_ITEM_ID_2}" not found`, status_code: 404 },
      id: LIST_ITEM_ID_2,
      index: 1,
    });
  });

  test('captures thrown errors as error_items and continues batch', async () => {
    updateListItemSpy
      .mockRejectedValueOnce(new Error('version conflict, current version [2] is different'))
      .mockResolvedValueOnce(getListItemResponseMock());

    const result = await bulkUpdateListItems(getOptions());

    expect(result.errors).toBe(true);
    expect(result.updated_count).toBe(1);
    expect(result.error_count).toBe(1);
    expect(result.error_items[0]).toEqual(
      expect.objectContaining({
        id: LIST_ITEM_ID,
        index: 0,
        error: expect.objectContaining({ status_code: 409 }),
      })
    );
    expect(result.items).toHaveLength(1);
  });

  test('assigns 500 status to generic errors', async () => {
    updateListItemSpy.mockRejectedValueOnce(new Error('unexpected failure'));
    updateListItemSpy.mockResolvedValueOnce(null);

    const result = await bulkUpdateListItems(getOptions());

    expect(result.error_items[0].error.status_code).toBe(500);
  });

  test('passes refresh parameter to updateListItem', async () => {
    updateListItemSpy.mockResolvedValue(getListItemResponseMock());
    const options = getOptions({ items: [{ _version: undefined, id: LIST_ITEM_ID, meta: META, value: VALUE }], refresh: 'true' });

    await bulkUpdateListItems(options);

    expect(updateListItemSpy).toHaveBeenCalledWith(
      expect.objectContaining({ refresh: true })
    );
  });

  test('passes false for refresh when refresh is "false"', async () => {
    updateListItemSpy.mockResolvedValue(getListItemResponseMock());
    const options = getOptions({
      items: [{ _version: undefined, id: LIST_ITEM_ID, meta: META, value: VALUE }],
      refresh: 'false',
    });

    await bulkUpdateListItems(options);

    expect(updateListItemSpy).toHaveBeenCalledWith(
      expect.objectContaining({ refresh: false })
    );
  });

  test('preserves original index in error_items', async () => {
    updateListItemSpy
      .mockResolvedValueOnce(getListItemResponseMock())
      .mockResolvedValueOnce(null);

    const result = await bulkUpdateListItems(getOptions());

    expect(result.error_items[0].index).toBe(1);
  });
});
