/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { CoreSetup, CoreStart, Plugin } from '@kbn/core/public';
import type {
  BootcampPublicSetup,
  BootcampPublicSetupDeps,
  BootcampPublicStart,
  BootcampPublicStartDeps,
} from './types';

export class BootcampPublicPlugin
  implements
    Plugin<
      BootcampPublicSetup,
      BootcampPublicStart,
      BootcampPublicSetupDeps,
      BootcampPublicStartDeps
    >
{
  public setup(core: CoreSetup, plugins: BootcampPublicSetupDeps): BootcampPublicSetup {
    return {};
  }

  public start(core: CoreStart, plugins: BootcampPublicStartDeps): BootcampPublicStart {
    return {};
  }
}
