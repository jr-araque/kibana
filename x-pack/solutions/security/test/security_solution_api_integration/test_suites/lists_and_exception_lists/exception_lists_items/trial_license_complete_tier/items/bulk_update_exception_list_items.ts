/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import expect from '@kbn/expect';

import {
  EXCEPTION_LIST_URL,
  EXCEPTION_LIST_ITEM_URL,
  EXCEPTION_LIST_ITEMS_BULK_URL,
} from '@kbn/securitysolution-list-constants';
import { getCreateExceptionListItemMinimalSchemaMock } from '@kbn/lists-plugin/common/schemas/request/create_exception_list_item_schema.mock';
import { getCreateExceptionListMinimalSchemaMock } from '@kbn/lists-plugin/common/schemas/request/create_exception_list_schema.mock';
import { getUpdateMinimalExceptionListItemSchemaMock } from '@kbn/lists-plugin/common/schemas/request/update_exception_list_item_schema.mock';

import { deleteAllExceptions } from '../../../utils';
import type { FtrProviderContext } from '../../../../../ftr_provider_context';

export default ({ getService }: FtrProviderContext) => {
  const supertest = getService('supertest');
  const log = getService('log');

  describe('@ess @serverless @serverlessQA bulk_update_exception_list_items', () => {
    afterEach(async () => {
      await deleteAllExceptions(supertest, log);
    });

    it('should bulk update multiple exception list items', async () => {
      // Create parent list
      await supertest
        .post(EXCEPTION_LIST_URL)
        .set('kbn-xsrf', 'true')
        .send(getCreateExceptionListMinimalSchemaMock())
        .expect(200);

      // Create two items
      await supertest
        .post(EXCEPTION_LIST_ITEM_URL)
        .set('kbn-xsrf', 'true')
        .send({ ...getCreateExceptionListItemMinimalSchemaMock(), item_id: 'item-1' })
        .expect(200);

      await supertest
        .post(EXCEPTION_LIST_ITEM_URL)
        .set('kbn-xsrf', 'true')
        .send({ ...getCreateExceptionListItemMinimalSchemaMock(), item_id: 'item-2' })
        .expect(200);

      // Bulk update both items
      const updatePayload = getUpdateMinimalExceptionListItemSchemaMock();
      const { body } = await supertest
        .put(EXCEPTION_LIST_ITEMS_BULK_URL)
        .set('kbn-xsrf', 'true')
        .send({
          items: [
            { ...updatePayload, item_id: 'item-1', name: 'updated name 1' },
            { ...updatePayload, item_id: 'item-2', name: 'updated name 2' },
          ],
        })
        .expect(200);

      expect(body.items).to.have.length(2);
      expect(body.errors).to.have.length(0);
      expect(body.summary).to.eql({ succeeded: 2, failed: 0, total: 2 });

      const names = body.items.map((item: { name: string }) => item.name).sort();
      expect(names).to.eql(['updated name 1', 'updated name 2']);
    });

    it('should return errors for nonexistent items without aborting the batch', async () => {
      // Create parent list
      await supertest
        .post(EXCEPTION_LIST_URL)
        .set('kbn-xsrf', 'true')
        .send(getCreateExceptionListMinimalSchemaMock())
        .expect(200);

      // Create one item
      await supertest
        .post(EXCEPTION_LIST_ITEM_URL)
        .set('kbn-xsrf', 'true')
        .send(getCreateExceptionListItemMinimalSchemaMock())
        .expect(200);

      // Bulk update: one real item, one nonexistent
      const updatePayload = getUpdateMinimalExceptionListItemSchemaMock();
      const { body } = await supertest
        .put(EXCEPTION_LIST_ITEMS_BULK_URL)
        .set('kbn-xsrf', 'true')
        .send({
          items: [
            { ...updatePayload, name: 'updated real item' },
            { ...updatePayload, item_id: 'nonexistent-item-id', name: 'should fail' },
          ],
        })
        .expect(200);

      expect(body.items).to.have.length(1);
      expect(body.items[0].name).to.eql('updated real item');
      expect(body.errors).to.have.length(1);
      expect(body.errors[0].item_id).to.eql('nonexistent-item-id');
      expect(body.errors[0].error.status_code).to.eql(404);
      expect(body.summary).to.eql({ succeeded: 1, failed: 1, total: 2 });
    });

    it('should return 400 when items array is empty', async () => {
      const { body } = await supertest
        .put(EXCEPTION_LIST_ITEMS_BULK_URL)
        .set('kbn-xsrf', 'true')
        .send({ items: [] })
        .expect(400);

      expect(body.message).to.contain('items');
    });

    it('should return a pre-validation error when neither id nor item_id is provided', async () => {
      // Create parent list
      await supertest
        .post(EXCEPTION_LIST_URL)
        .set('kbn-xsrf', 'true')
        .send(getCreateExceptionListMinimalSchemaMock())
        .expect(200);

      const { item_id: _itemId, ...updateWithoutItemId } =
        getUpdateMinimalExceptionListItemSchemaMock();

      const { body } = await supertest
        .put(EXCEPTION_LIST_ITEMS_BULK_URL)
        .set('kbn-xsrf', 'true')
        .send({
          items: [updateWithoutItemId],
        })
        .expect(200);

      expect(body.items).to.have.length(0);
      expect(body.errors).to.have.length(1);
      expect(body.errors[0].error.status_code).to.eql(400);
      expect(body.errors[0].error.message).to.contain('either id or item_id');
      expect(body.summary).to.eql({ succeeded: 0, failed: 1, total: 1 });
    });

    it('should return a pre-validation error for non-append-only comments', async () => {
      // Create parent list
      await supertest
        .post(EXCEPTION_LIST_URL)
        .set('kbn-xsrf', 'true')
        .send(getCreateExceptionListMinimalSchemaMock())
        .expect(200);

      // Create an item with a comment
      const createPayload = {
        ...getCreateExceptionListItemMinimalSchemaMock(),
        comments: [{ comment: 'original comment' }],
      };
      await supertest
        .post(EXCEPTION_LIST_ITEM_URL)
        .set('kbn-xsrf', 'true')
        .send(createPayload)
        .expect(200);

      // Try to bulk update with a new comment inserted before the existing one (non-append-only)
      const updatePayload = getUpdateMinimalExceptionListItemSchemaMock();
      const { body } = await supertest
        .put(EXCEPTION_LIST_ITEMS_BULK_URL)
        .set('kbn-xsrf', 'true')
        .send({
          items: [
            {
              ...updatePayload,
              comments: [
                { comment: 'new comment without id' },
                { id: 'some-id', comment: 'existing comment with id after new' },
              ],
            },
          ],
        })
        .expect(200);

      expect(body.items).to.have.length(0);
      expect(body.errors).to.have.length(1);
      expect(body.errors[0].error.status_code).to.eql(400);
      expect(body.errors[0].error.message).to.contain('append only');
      expect(body.summary).to.eql({ succeeded: 0, failed: 1, total: 1 });
    });

    it('should return the full response shape with summary', async () => {
      // Create parent list
      await supertest
        .post(EXCEPTION_LIST_URL)
        .set('kbn-xsrf', 'true')
        .send(getCreateExceptionListMinimalSchemaMock())
        .expect(200);

      // Create one item
      await supertest
        .post(EXCEPTION_LIST_ITEM_URL)
        .set('kbn-xsrf', 'true')
        .send(getCreateExceptionListItemMinimalSchemaMock())
        .expect(200);

      const updatePayload = getUpdateMinimalExceptionListItemSchemaMock();
      const { body } = await supertest
        .put(EXCEPTION_LIST_ITEMS_BULK_URL)
        .set('kbn-xsrf', 'true')
        .send({
          items: [{ ...updatePayload, name: 'response shape test' }],
        })
        .expect(200);

      // Verify full response shape
      expect(body).to.have.property('items');
      expect(body).to.have.property('errors');
      expect(body).to.have.property('summary');
      expect(body.summary).to.have.property('succeeded');
      expect(body.summary).to.have.property('failed');
      expect(body.summary).to.have.property('total');

      // Verify item has expected fields
      const [item] = body.items;
      expect(item).to.have.property('id');
      expect(item).to.have.property('item_id');
      expect(item).to.have.property('name');
      expect(item).to.have.property('entries');
      expect(item).to.have.property('type');
      expect(item.name).to.eql('response shape test');
    });
  });
};
