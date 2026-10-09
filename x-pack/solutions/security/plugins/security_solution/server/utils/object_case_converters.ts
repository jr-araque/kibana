/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */
import camelcaseKeys from 'camelcase-keys';
import { isPlainObject, snakeCase } from 'lodash';
import type { CamelCasedPropertiesDeep, SnakeCasedPropertiesDeep } from 'type-fest';

export const convertObjectKeysToCamelCase = <T extends Record<string, unknown>>(obj: T) => {
  return camelcaseKeys(obj, { deep: true }) as CamelCasedPropertiesDeep<T>;
};

const snakeCaseKeysDeep = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(snakeCaseKeysDeep);
  }
  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, nestedValue]) => [
        snakeCase(key),
        snakeCaseKeysDeep(nestedValue),
      ])
    );
  }
  return value;
};

export const convertObjectKeysToSnakeCase = <T extends Record<string, unknown>>(obj: T) => {
  return snakeCaseKeysDeep(obj) as SnakeCasedPropertiesDeep<T>;
};
