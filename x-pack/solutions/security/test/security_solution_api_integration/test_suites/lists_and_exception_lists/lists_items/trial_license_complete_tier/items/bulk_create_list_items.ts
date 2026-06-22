/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import expect from '@kbn/expect';

import { LIST_URL, LIST_ITEM_BULK_CREATE_URL } from '@kbn/securitysolution-list-constants';
import { getCreateMinimalListSchemaMock } from '@kbn/lists-plugin/common/schemas/request/create_list_schema.mock';
import { LIST_ID, VALUE, VALUE_2 } from '@kbn/lists-plugin/common/constants.mock';
import type TestAgent from 'supertest/lib/agent';
import {
  createListsIndex,
  deleteListsIndex,
  removeListItemServerGeneratedProperties,
} from '../../../utils';

import type { FtrProviderContext } from '../../../../../ftr_provider_context';

export default ({ getService }: FtrProviderContext) => {
  const log = getService('log');
  const utils = getService('securitySolutionUtils');

  describe('@ess @serverless @serverlessQA bulk_create_list_items', () => {
    let supertest: TestAgent;

    before(async () => {
      supertest = await utils.createSuperTest();
    });

    describe('validation errors', () => {
      it('should give a 404 error that the list must exist first before being able to bulk create items', async () => {
        const { body } = await supertest
          .post(LIST_ITEM_BULK_CREATE_URL)
          .set('kbn-xsrf', 'true')
          .send({ list_id: LIST_ID, value: [VALUE] })
          .expect(404);

        expect(body).to.eql({
          message: `list id: "${LIST_ID}" does not exist`,
          status_code: 404,
        });
      });
    });

    describe('bulk creating list items', () => {
      beforeEach(async () => {
        await createListsIndex(supertest, log);
      });

      afterEach(async () => {
        await deleteListsIndex(supertest, log);
      });

      it('should bulk create list items and return per-item results', async () => {
        await supertest
          .post(LIST_URL)
          .set('kbn-xsrf', 'true')
          .send(getCreateMinimalListSchemaMock())
          .expect(200);

        const { body } = await supertest
          .post(LIST_ITEM_BULK_CREATE_URL)
          .set('kbn-xsrf', 'true')
          .send({ list_id: LIST_ID, value: [VALUE, VALUE_2] })
          .expect(200);

        expect(body.errors).to.eql(false);
        expect(body.created_count).to.eql(2);
        expect(body.error_count).to.eql(0);
        expect(body.items).to.have.length(2);
        expect(body.error_items).to.have.length(0);

        const username = await utils.getUsername();
        const firstItem = removeListItemServerGeneratedProperties(body.items[0]);
        expect(firstItem).to.eql({
          created_by: username,
          list_id: LIST_ID,
          meta: undefined,
          type: 'ip',
          updated_by: username,
          value: VALUE,
        });
      });

      it('should bulk create a single item', async () => {
        await supertest
          .post(LIST_URL)
          .set('kbn-xsrf', 'true')
          .send(getCreateMinimalListSchemaMock())
          .expect(200);

        const { body } = await supertest
          .post(LIST_ITEM_BULK_CREATE_URL)
          .set('kbn-xsrf', 'true')
          .send({ list_id: LIST_ID, value: [VALUE] })
          .expect(200);

        expect(body.errors).to.eql(false);
        expect(body.created_count).to.eql(1);
        expect(body.items).to.have.length(1);
        expect(body.items[0].value).to.eql(VALUE);
        expect(body.items[0].list_id).to.eql(LIST_ID);
        expect(body.items[0].type).to.eql('ip');
      });

      it('should return items with proper metadata fields', async () => {
        await supertest
          .post(LIST_URL)
          .set('kbn-xsrf', 'true')
          .send(getCreateMinimalListSchemaMock())
          .expect(200);

        const { body } = await supertest
          .post(LIST_ITEM_BULK_CREATE_URL)
          .set('kbn-xsrf', 'true')
          .send({ list_id: LIST_ID, value: [VALUE], meta: { key: 'value' } })
          .expect(200);

        expect(body.items[0].meta).to.eql({ key: 'value' });
        expect(body.items[0]).to.have.property('id');
        expect(body.items[0]).to.have.property('tie_breaker_id');
        expect(body.items[0]).to.have.property('created_at');
        expect(body.items[0]).to.have.property('updated_at');
        expect(body.items[0]).to.have.property('_version');
      });
    });
  });
};
