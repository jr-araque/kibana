/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { elasticsearchClientMock } from '@kbn/core-elasticsearch-client-server-mocks';

import {
  DATE_NOW,
  LIST_ID,
  LIST_ITEM_INDEX,
  META,
  TYPE,
  USER,
  VALUE,
  VALUE_2,
} from '../../../common/constants.mock';

import type { BulkCreateListItemsOptions } from './bulk_create_list_items';
import { bulkCreateListItems } from './bulk_create_list_items';

const getOptions = (
  overrides: Partial<BulkCreateListItemsOptions> = {}
): BulkCreateListItemsOptions => ({
  dateNow: DATE_NOW,
  esClient: elasticsearchClientMock.createScopedClusterClient().asCurrentUser,
  listId: LIST_ID,
  listItemIndex: LIST_ITEM_INDEX,
  meta: META,
  type: TYPE,
  user: USER,
  value: [VALUE, VALUE_2],
  ...overrides,
});

const mockBulkResponse = (
  items: Array<{
    _id: string;
    _seq_no: number;
    _primary_term: number;
    status: number;
    error?: { reason: string; type: string };
  }>
): object => ({
  errors: items.some((item) => item.error != null),
  items: items.map((item) => ({
    create: {
      _id: item._id,
      _index: LIST_ITEM_INDEX,
      _primary_term: item._primary_term,
      _seq_no: item._seq_no,
      _version: 1,
      error: item.error,
      result: item.error ? undefined : 'created',
      status: item.status,
    },
  })),
  took: 10,
});

describe('bulk_create_list_items', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('returns empty results for empty value array', async () => {
    const options = getOptions({ value: [] });
    const result = await bulkCreateListItems(options);

    expect(result).toEqual({
      created_count: 0,
      error_count: 0,
      error_items: [],
      errors: false,
      items: [],
    });
    expect(options.esClient.bulk).not.toHaveBeenCalled();
  });

  test('calls esClient.bulk with correct body structure', async () => {
    const options = getOptions();
    (options.esClient.bulk as jest.Mock).mockResolvedValue(
      mockBulkResponse([
        { _id: 'id-1', _primary_term: 1, _seq_no: 0, status: 201 },
        { _id: 'id-2', _primary_term: 1, _seq_no: 1, status: 201 },
      ])
    );

    await bulkCreateListItems(options);

    expect(options.esClient.bulk).toHaveBeenCalledWith(
      expect.objectContaining({
        index: LIST_ITEM_INDEX,
        refresh: 'wait_for',
      })
    );

    const [[bulkCallArgs]] = (options.esClient.bulk as jest.Mock).mock.calls;
    const { body } = bulkCallArgs;
    expect(body).toHaveLength(4);
    expect(body[0]).toHaveProperty('create');
    expect(body[1]).toHaveProperty('ip', VALUE);
    expect(body[2]).toHaveProperty('create');
    expect(body[3]).toHaveProperty('ip', VALUE_2);
  });

  test('returns created items on success', async () => {
    const options = getOptions();
    (options.esClient.bulk as jest.Mock).mockResolvedValue(
      mockBulkResponse([
        { _id: 'id-1', _primary_term: 1, _seq_no: 0, status: 201 },
        { _id: 'id-2', _primary_term: 1, _seq_no: 1, status: 201 },
      ])
    );

    const result = await bulkCreateListItems(options);

    expect(result.errors).toBe(false);
    expect(result.created_count).toBe(2);
    expect(result.error_count).toBe(0);
    expect(result.items).toHaveLength(2);
    expect(result.error_items).toHaveLength(0);

    expect(result.items[0]).toEqual(
      expect.objectContaining({
        created_at: DATE_NOW,
        created_by: USER,
        list_id: LIST_ID,
        type: TYPE,
        updated_at: DATE_NOW,
        updated_by: USER,
        value: VALUE,
      })
    );
    expect(result.items[1]).toEqual(
      expect.objectContaining({
        value: VALUE_2,
      })
    );
  });

  test('captures ES bulk errors as error_items', async () => {
    const options = getOptions();
    (options.esClient.bulk as jest.Mock).mockResolvedValue(
      mockBulkResponse([
        { _id: 'id-1', _primary_term: 1, _seq_no: 0, status: 201 },
        {
          _id: 'id-2',
          _primary_term: 1,
          _seq_no: 1,
          error: { reason: 'mapping error', type: 'mapper_parsing_exception' },
          status: 400,
        },
      ])
    );

    const result = await bulkCreateListItems(options);

    expect(result.errors).toBe(true);
    expect(result.created_count).toBe(1);
    expect(result.error_count).toBe(1);
    expect(result.items).toHaveLength(1);
    expect(result.error_items).toHaveLength(1);
    expect(result.error_items[0]).toEqual({
      error: {
        message: 'mapping error',
        status_code: 400,
      },
      index: 1,
      value: VALUE_2,
    });
  });

  test('uses wait_for refresh by default', async () => {
    const options = getOptions();
    (options.esClient.bulk as jest.Mock).mockResolvedValue(
      mockBulkResponse([{ _id: 'id-1', _primary_term: 1, _seq_no: 0, status: 201 }])
    );
    options.value = [VALUE];

    await bulkCreateListItems(options);

    expect(options.esClient.bulk).toHaveBeenCalledWith(
      expect.objectContaining({ refresh: 'wait_for' })
    );
  });

  test('respects custom refresh parameter', async () => {
    const options = getOptions({ refresh: 'false', value: [VALUE] });
    (options.esClient.bulk as jest.Mock).mockResolvedValue(
      mockBulkResponse([{ _id: 'id-1', _primary_term: 1, _seq_no: 0, status: 201 }])
    );

    await bulkCreateListItems(options);

    expect(options.esClient.bulk).toHaveBeenCalledWith(
      expect.objectContaining({ refresh: 'false' })
    );
  });
});
