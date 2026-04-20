/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type {
  FieldsMetadataPublicSetup,
  FieldsMetadataPublicStart,
} from '@kbn/fields-metadata-plugin/public';
import type { SpacesPluginSetup, SpacesPluginStart } from '@kbn/spaces-plugin/public';

export interface BootcampPublicSetupDeps {
  spaces: SpacesPluginSetup;
  fieldsMetatada?: FieldsMetadataPublicSetup;
}

export interface BootcampPublicSetup {}

export interface BootcampPublicStartDeps {
  spaces: SpacesPluginStart;
  fieldsMetadata?: FieldsMetadataPublicStart;
}

export interface BootcampPublicStart {}
