/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type * as estypes from '@elastic/elasticsearch/lib/api/typesWithBodyKey';
import { ElasticsearchClient } from '@kbn/core/server';
import type { Id, ListItemSchema } from '@kbn/securitysolution-io-ts-list-types';

import { transformElasticHitsToListItem } from '../utils';
import { findSourceType } from '../utils/find_source_type';
import { SearchEsListItemSchema } from '../../schemas/elastic_response';

interface GetListItemOptions {
  id: Id;
  esClient: ElasticsearchClient;
  listItemIndex: string;
}

// esClient.get is used intentionally over esClient.search: get reads from the shard/translog in
// real-time, making freshly written documents visible before the next segment refresh. search only
// sees refreshed segments, which forced create_list_item.ts to block on refresh:'wait_for' (~1s)
// after every write to guarantee this read-back would not 404.
export const getListItem = async ({
  id,
  esClient,
  listItemIndex,
}: GetListItemOptions): Promise<ListItemSchema | null> => {
  let response: estypes.GetResponse<SearchEsListItemSchema>;
  try {
    response = await esClient.get<SearchEsListItemSchema>({
      id,
      index: listItemIndex,
      seq_no_primary_term: true,
    });
  } catch (err) {
    // 404 covers both "document not found" and "index does not exist"
    if (err.statusCode === 404) {
      return null;
    }
    throw err;
  }

  if (!response.found || response._source == null) {
    return null;
  }

  const type = findSourceType(response._source);
  if (type == null) {
    return null;
  }

  // Cast to SearchHit shape so we can reuse the shared transform without duplicating logic.
  // get() and search() hits carry the same fields (_id, _source, _seq_no, _primary_term).
  const hit = {
    _id: response._id,
    _index: response._index,
    _source: response._source,
    _seq_no: response._seq_no,
    _primary_term: response._primary_term,
  } as estypes.SearchHit<SearchEsListItemSchema>;

  const listItems = transformElasticHitsToListItem({ hits: [hit], type });
  return listItems[0];
};
