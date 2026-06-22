/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import expect from '@kbn/expect';

import {
  EXCEPTION_LIST_ITEMS_BULK_URL,
  EXCEPTION_LIST_URL,
} from '@kbn/securitysolution-list-constants';
import { getCreateExceptionListMinimalSchemaMock } from '@kbn/lists-plugin/common/schemas/request/create_exception_list_schema.mock';

import { deleteAllExceptions } from '../../../utils';
import type { FtrProviderContext } from '../../../../../ftr_provider_context';

const makeItem = (index: number) => ({
  description: `Bulk item ${index}`,
  entries: [
    {
      field: 'host.name',
      operator: 'included',
      type: 'match',
      value: `value-${index}`,
    },
  ],
  item_id: `bulk-item-${index}`,
  name: `Bulk item ${index}`,
  type: 'simple',
});

export default ({ getService }: FtrProviderContext) => {
  const supertest = getService('supertest');
  const log = getService('log');

  describe('@ess @serverless @serverlessQA bulk_create_exception_list_items', () => {
    afterEach(async () => {
      await deleteAllExceptions(supertest, log);
    });

    describe('validation errors', () => {
      it('should return 404 if the exception list does not exist', async () => {
        const { body } = await supertest
          .post(EXCEPTION_LIST_ITEMS_BULK_URL)
          .set('kbn-xsrf', 'true')
          .send({
            items: [makeItem(1)],
            list_id: 'non-existent-list',
            namespace_type: 'single',
          })
          .expect(404);

        expect(body.message).to.contain('non-existent-list');
        expect(body.status_code).to.be(404);
      });

      it('should return 400 if items array exceeds 1000', async () => {
        await supertest
          .post(EXCEPTION_LIST_URL)
          .set('kbn-xsrf', 'true')
          .send(getCreateExceptionListMinimalSchemaMock())
          .expect(200);

        const items = Array.from({ length: 1001 }, (_, i) => makeItem(i));

        const { body } = await supertest
          .post(EXCEPTION_LIST_ITEMS_BULK_URL)
          .set('kbn-xsrf', 'true')
          .send({
            items,
            list_id: 'some-list-id',
            namespace_type: 'single',
          })
          .expect(400);

        expect(body.message).to.contain('1000');
      });

      it('should return 400 if items array is empty', async () => {
        await supertest
          .post(EXCEPTION_LIST_ITEMS_BULK_URL)
          .set('kbn-xsrf', 'true')
          .send({
            items: [],
            list_id: 'some-list-id',
            namespace_type: 'single',
          })
          .expect(400);
      });
    });

    describe('creating items', () => {
      it('should bulk create multiple exception list items', async () => {
        await supertest
          .post(EXCEPTION_LIST_URL)
          .set('kbn-xsrf', 'true')
          .send(getCreateExceptionListMinimalSchemaMock())
          .expect(200);

        const { body } = await supertest
          .post(EXCEPTION_LIST_ITEMS_BULK_URL)
          .set('kbn-xsrf', 'true')
          .send({
            items: [makeItem(1), makeItem(2), makeItem(3)],
            list_id: 'some-list-id',
            namespace_type: 'single',
          })
          .expect(200);

        expect(body.items).to.have.length(3);
        expect(body.errors).to.have.length(0);
        expect(body.items[0].item_id).to.be('bulk-item-1');
        expect(body.items[1].item_id).to.be('bulk-item-2');
        expect(body.items[2].item_id).to.be('bulk-item-3');
      });

      it('should auto-generate item_id when not provided', async () => {
        await supertest
          .post(EXCEPTION_LIST_URL)
          .set('kbn-xsrf', 'true')
          .send(getCreateExceptionListMinimalSchemaMock())
          .expect(200);

        const { body } = await supertest
          .post(EXCEPTION_LIST_ITEMS_BULK_URL)
          .set('kbn-xsrf', 'true')
          .send({
            items: [
              {
                description: 'No explicit item_id',
                entries: [
                  { field: 'host.name', operator: 'included', type: 'match', value: 'test' },
                ],
                name: 'Auto-id item',
                type: 'simple',
              },
            ],
            list_id: 'some-list-id',
            namespace_type: 'single',
          })
          .expect(200);

        expect(body.items).to.have.length(1);
        expect(body.items[0].item_id).to.be.a('string');
        expect(body.items[0].item_id.length).to.be.greaterThan(0);
      });

      it('should report duplicate item_ids within the same request', async () => {
        await supertest
          .post(EXCEPTION_LIST_URL)
          .set('kbn-xsrf', 'true')
          .send(getCreateExceptionListMinimalSchemaMock())
          .expect(200);

        const { body } = await supertest
          .post(EXCEPTION_LIST_ITEMS_BULK_URL)
          .set('kbn-xsrf', 'true')
          .send({
            items: [makeItem(1), makeItem(1)],
            list_id: 'some-list-id',
            namespace_type: 'single',
          })
          .expect(200);

        expect(body.items).to.have.length(1);
        expect(body.errors).to.have.length(1);
        expect(body.errors[0].error.status_code).to.be(409);
        expect(body.errors[0].error.message).to.contain('Duplicate');
      });

      it('should return full item objects in the response', async () => {
        await supertest
          .post(EXCEPTION_LIST_URL)
          .set('kbn-xsrf', 'true')
          .send(getCreateExceptionListMinimalSchemaMock())
          .expect(200);

        const { body } = await supertest
          .post(EXCEPTION_LIST_ITEMS_BULK_URL)
          .set('kbn-xsrf', 'true')
          .send({
            items: [makeItem(1)],
            list_id: 'some-list-id',
            namespace_type: 'single',
          })
          .expect(200);

        const item = body.items[0];
        expect(item).to.have.property('id');
        expect(item).to.have.property('item_id', 'bulk-item-1');
        expect(item).to.have.property('list_id', 'some-list-id');
        expect(item).to.have.property('name', 'Bulk item 1');
        expect(item).to.have.property('description', 'Bulk item 1');
        expect(item).to.have.property('created_at');
        expect(item).to.have.property('created_by');
        expect(item).to.have.property('entries');
        expect(item).to.have.property('type', 'simple');
        expect(item).to.have.property('namespace_type', 'single');
      });
    });
  });
};
