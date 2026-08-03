/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import dateMath from '@kbn/datemath';
import type { DataViewFieldBase } from '@kbn/es-query';
import {
  type ListOperatorType,
  ListOperatorTypeEnum as OperatorTypeEnum,
} from '@kbn/securitysolution-io-ts-list-types';
import ipaddr from 'ipaddr.js';
import { checkEmptyValue } from '../check_empty_value';

import * as i18n from '../translations';

const isValidIp = (value: string): boolean => {
  if (value.includes('%')) {
    return false;
  }

  if (ipaddr.IPv4.isValidFourPartDecimal(value)) {
    return true;
  }

  const embeddedIpv4 = value.slice(value.lastIndexOf(':') + 1);
  return (
    ipaddr.IPv6.isValid(value) &&
    (!value.includes('.') || ipaddr.IPv4.isValidFourPartDecimal(embeddedIpv4))
  );
};

const isValidIpOrCidr = (value: string): boolean => {
  const separatorIndex = value.lastIndexOf('/');
  if (separatorIndex === -1) {
    return isValidIp(value);
  }

  if (!isValidIp(value.slice(0, separatorIndex))) {
    return false;
  }

  try {
    ipaddr.parseCIDR(value);
    return true;
  } catch {
    return false;
  }
};

/**
 * Very basic validation for values
 * @param param the value being checked
 * @param field the selected field
 * @param isRequired whether or not an empty value is allowed
 * @param touched has field been touched by user
 * @param operatorType the exception entry operator type
 * @returns undefined if valid, string with error message if invalid
 */
export const paramIsValid = (
  param: string | undefined,
  field: DataViewFieldBase | undefined,
  isRequired: boolean,
  touched: boolean,
  operatorType: ListOperatorType
): string | undefined => {
  if (field == null) {
    return undefined;
  }

  const emptyValueError = checkEmptyValue(param, field, isRequired, touched);
  if (emptyValueError !== null) {
    return emptyValueError;
  }

  switch (field.type) {
    case 'date':
      const moment = dateMath.parse(param ?? '');
      const isDate = Boolean(moment && moment.isValid());
      return isDate ? undefined : i18n.DATE_ERR;
    case 'number':
      const isNum = param != null && param.trim() !== '' && !isNaN(+param);
      return isNum ? undefined : i18n.NUMBER_ERR;
    case 'ip':
      if (operatorType !== OperatorTypeEnum.MATCH && operatorType !== OperatorTypeEnum.MATCH_ANY) {
        return undefined;
      }

      return param != null && isValidIpOrCidr(param) ? undefined : i18n.IP_ERR;
    default:
      return undefined;
  }
};
