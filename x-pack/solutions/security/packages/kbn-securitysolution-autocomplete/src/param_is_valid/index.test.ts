/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { paramIsValid } from '.';
import { getField } from '../fields/index.mock';
import * as i18n from '../translations';
import { ListOperatorTypeEnum as OperatorTypeEnum } from '@kbn/securitysolution-io-ts-list-types';
import type { DataViewFieldBase } from '@kbn/es-query';
import moment from 'moment';

const paramIsValidForMatch = (
  param: string | undefined,
  field: DataViewFieldBase | undefined,
  isRequired: boolean,
  touched: boolean
): string | undefined => {
  return paramIsValid(param, field, isRequired, touched, OperatorTypeEnum.MATCH);
};

describe('params_is_valid', () => {
  beforeEach(() => {
    // Disable momentJS deprecation warning and it looks like it is not typed either so
    // we have to disable the type as well and cannot extend it easily.
    (
      moment as unknown as {
        suppressDeprecationWarnings: boolean;
      }
    ).suppressDeprecationWarnings = true;
  });

  afterEach(() => {
    // Re-enable momentJS deprecation warning and it looks like it is not typed either so
    // we have to disable the type as well and cannot extend it easily.
    (
      moment as unknown as {
        suppressDeprecationWarnings: boolean;
      }
    ).suppressDeprecationWarnings = false;
  });

  test('returns no errors if no field has been selected', () => {
    const isValid = paramIsValidForMatch('', undefined, true, false);

    expect(isValid).toBeUndefined();
  });

  test('returns error string if user has touched a required input and left empty', () => {
    const isValid = paramIsValidForMatch(undefined, getField('@timestamp'), true, true);

    expect(isValid).toEqual(i18n.FIELD_REQUIRED_ERR);
  });

  test('returns no errors if required input is empty but user has not yet touched it', () => {
    const isValid = paramIsValidForMatch(undefined, getField('@timestamp'), true, false);

    expect(isValid).toBeUndefined();
  });

  test('returns no errors if user has touched an input that is not required and left empty', () => {
    const isValid = paramIsValidForMatch(undefined, getField('@timestamp'), false, true);

    expect(isValid).toBeUndefined();
  });

  test('returns no errors if user has touched an input that is not required and left empty string', () => {
    const isValid = paramIsValidForMatch('', getField('@timestamp'), false, true);

    expect(isValid).toBeUndefined();
  });

  test('returns no errors if field is of type date and value is valid', () => {
    const isValid = paramIsValidForMatch(
      '1994-11-05T08:15:30-05:00',
      getField('@timestamp'),
      false,
      true
    );

    expect(isValid).toBeUndefined();
  });

  test('returns errors if filed is of type date and value is not valid', () => {
    const isValid = paramIsValidForMatch('1593478826', getField('@timestamp'), false, true);

    expect(isValid).toEqual(i18n.DATE_ERR);
  });

  test('returns no errors if field is of type number and value is an integer', () => {
    const isValid = paramIsValidForMatch('4', getField('bytes'), true, true);

    expect(isValid).toBeUndefined();
  });

  test('returns no errors if field is of type number and value is a float', () => {
    const isValid = paramIsValidForMatch('4.3', getField('bytes'), true, true);

    expect(isValid).toBeUndefined();
  });

  test('returns no errors if field is of type number and value is a long', () => {
    const isValid = paramIsValidForMatch('-9223372036854775808', getField('bytes'), true, true);

    expect(isValid).toBeUndefined();
  });

  test('returns errors if field is of type number and value is "hello"', () => {
    const isValid = paramIsValidForMatch('hello', getField('bytes'), true, true);

    expect(isValid).toEqual(i18n.NUMBER_ERR);
  });

  test('returns errors if field is of type number and value is "123abc"', () => {
    const isValid = paramIsValidForMatch('123abc', getField('bytes'), true, true);

    expect(isValid).toEqual(i18n.NUMBER_ERR);
  });

  describe('IP fields', () => {
    test('defines a localized IP validation error', () => {
      expect(i18n.IP_ERR).toEqual('Not a valid IP address');
    });

    test.each([
      '0.0.0.0',
      '127.0.0.1',
      '255.255.255.255',
      '2001:db8::1',
      '::1',
      '::ffff:192.0.2.128',
      '127.0.0.1/30',
      '2001:db8::/32',
      '::1/128',
    ])('returns no errors for valid IP value "%s"', (value) => {
      const isValid = paramIsValid(value, getField('ip'), true, true, OperatorTypeEnum.MATCH);

      expect(isValid).toBeUndefined();
    });

    test.each([
      '1.1.1.',
      '123097808',
      '.1.1.1',
      '1.2.3',
      '01.02.03.04',
      '0x7f000001',
      ' 127.0.0.1',
      '127.0.0.1 ',
      '127.0.0.1/33',
      '2001:db8::/129',
      'fe80::1%eth0',
      '::ffff:01.02.03.04',
      'not-an-ip',
    ])('returns an error for invalid IP value "%s"', (value) => {
      const isValid = paramIsValidForMatch(value, getField('ip'), true, true);

      expect(isValid).toEqual(i18n.IP_ERR);
    });

    test('validates match-any IP values', () => {
      const invalidValue = paramIsValid(
        '123097808',
        getField('ip'),
        true,
        true,
        OperatorTypeEnum.MATCH_ANY
      );
      const validValue = paramIsValid(
        '127.0.0.1/30',
        getField('ip'),
        true,
        true,
        OperatorTypeEnum.MATCH_ANY
      );

      expect(invalidValue).toEqual(i18n.IP_ERR);
      expect(validValue).toBeUndefined();
    });

    test('does not apply IP-literal validation to wildcard values', () => {
      const isValid = paramIsValid('127.*', getField('ip'), true, true, OperatorTypeEnum.WILDCARD);

      expect(isValid).toBeUndefined();
    });
  });
});
