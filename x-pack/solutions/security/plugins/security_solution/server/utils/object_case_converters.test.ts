/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */
import {
  convertObjectKeysToCamelCase,
  convertObjectKeysToSnakeCase,
} from './object_case_converters';

describe('object_case_converters', () => {
  describe('convertObjectKeysToSnakeCase', () => {
    it('converts nested object keys', () => {
      expect(
        convertObjectKeysToSnakeCase({
          groupBy: ['host.name'],
          duration: { value: 5, unit: 'm' },
          missingFieldsStrategy: 'suppress',
        })
      ).toEqual({
        group_by: ['host.name'],
        duration: { value: 5, unit: 'm' },
        missing_fields_strategy: 'suppress',
      });
    });

    it('converts keys of objects inside arrays', () => {
      expect(
        convertObjectKeysToSnakeCase({
          type: 'external',
          isCustomized: true,
          customizedFields: [{ fieldName: 'name' }, { fieldName: 'tags' }],
        })
      ).toEqual({
        type: 'external',
        is_customized: true,
        customized_fields: [{ field_name: 'name' }, { field_name: 'tags' }],
      });
    });

    it('does not change values', () => {
      expect(convertObjectKeysToSnakeCase({ someKey: 'someValue', otherKey: null })).toEqual({
        some_key: 'someValue',
        other_key: null,
      });
    });
  });

  describe('convertObjectKeysToCamelCase', () => {
    it('converts nested object keys, including objects inside arrays', () => {
      expect(
        convertObjectKeysToCamelCase({
          is_customized: true,
          customized_fields: [{ field_name: 'name' }],
        })
      ).toEqual({
        isCustomized: true,
        customizedFields: [{ fieldName: 'name' }],
      });
    });
  });
});
