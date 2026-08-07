/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { estypes } from '@elastic/elasticsearch';
import { partition } from 'lodash';

import type { ExceptionListItemSchema } from '@kbn/securitysolution-io-ts-list-types';
import {
  entriesList,
  entriesMatch,
  entriesMatchAny,
  entriesExists,
} from '@kbn/securitysolution-io-ts-list-types';

import { hasLargeValueList } from '@kbn/securitysolution-list-utils';

import type { FilterEventsAgainstListOptions, FilterEventsAgainstListReturn } from './types';
import { partitionEvents } from './filter_events';
import { createFieldAndSetTuples } from './create_field_and_set_tuples';

const matchesScalarEntries = <T>(
  event: estypes.SearchHit<T>,
  exceptionItem: ExceptionListItemSchema
): boolean => {
  const scalarEntries = exceptionItem.entries.filter((entry) => !entriesList.is(entry));
  if (scalarEntries.length === 0) return true;

  return scalarEntries.every((entry) => {
    const rawValue = event.fields?.[entry.field];
    const fieldValues: string[] = rawValue == null ? [] : [rawValue].flat().map(String);

    if (entriesMatch.is(entry)) {
      const matched = fieldValues.includes(entry.value);
      return entry.operator === 'included' ? matched : !matched;
    }
    if (entriesMatchAny.is(entry)) {
      const matched = fieldValues.some((v) => entry.value.includes(v));
      return entry.operator === 'included' ? matched : !matched;
    }
    if (entriesExists.is(entry)) {
      const exists = fieldValues.length > 0;
      return entry.operator === 'included' ? exists : !exists;
    }
    return true;
  });
};

/**
 * Filters events against a large value based list. It does this through these
 * steps below.
 *
 * 1. acquire the values from the specified fields to check
 * e.g. if the value list is checking against source.ip, gather
 * all the values for source.ip from the search response events.
 *
 * 2. search against the value list with the values found in the search result
 * and see if there are any matches. For every match, add that value to a set
 * that represents the "matched" values
 *
 * 3. filter the search result against the set from step 2 using the
 * given operator (included vs excluded).
 * acquire the list values we are checking for in the field.
 *
 * @param listClient The list client to use for queries
 * @param exceptionsList The exception list
 * @param ruleExecutionLogger Logger for messages
 * @param events The current events from the search
 */
export const filterEventsAgainstList = async <T>({
  listClient,
  exceptionsList,
  ruleExecutionLogger,
  events,
}: FilterEventsAgainstListOptions<T>): Promise<FilterEventsAgainstListReturn<T>> => {
  try {
    const atLeastOneLargeValueList = exceptionsList.some(({ entries }) =>
      hasLargeValueList(entries)
    );

    if (!atLeastOneLargeValueList) {
      ruleExecutionLogger.debug(
        'No exception items of type list found\nReturning unfiltered events.'
      );
      return [events, []];
    }

    const valueListExceptionItems = exceptionsList.filter((listItem: ExceptionListItemSchema) => {
      return listItem.entries.some((entry) => entriesList.is(entry));
    });

    // Every event starts out in the 'included' list, and each value list item checks all the
    // current 'included' events and moves events that match the exception to the 'excluded' list
    return valueListExceptionItems.reduce<Promise<FilterEventsAgainstListReturn<T>>>(
      async (
        filteredAccum: Promise<FilterEventsAgainstListReturn<T>>,
        exceptionItem: ExceptionListItemSchema
      ) => {
        const [includedEvents, excludedEvents] = await filteredAccum;
        const fieldAndSetTuples = await createFieldAndSetTuples({
          events: includedEvents,
          exceptionItem,
          listClient,
          ruleExecutionLogger,
        });
        const [nextIncludedEvents, nextExcludedEvents] = partitionEvents({
          events: includedEvents,
          fieldAndSetTuples,
        });

        const hasScalarEntries = exceptionItem.entries.some((entry) => !entriesList.is(entry));
        const [finalExcludedEvents, restoredToIncluded] = hasScalarEntries
          ? partition(nextExcludedEvents, (event) => matchesScalarEntries(event, exceptionItem))
          : [nextExcludedEvents, [] as typeof nextExcludedEvents];

        ruleExecutionLogger.debug(
          `Events filtered by exception: ${finalExcludedEvents.length}\nException ID: "${exceptionItem.id}".`
        );
        return [
          [...nextIncludedEvents, ...restoredToIncluded],
          [...excludedEvents, ...finalExcludedEvents],
        ];
      },
      Promise.resolve<FilterEventsAgainstListReturn<T>>([events, []])
    );
  } catch (exc) {
    throw new Error(`Failed to query large value based lists index. Reason: ${exc.message}`);
  }
};
