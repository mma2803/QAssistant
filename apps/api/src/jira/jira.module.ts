import { Global, Module } from '@nestjs/common';
import { APP_CONFIG } from '../config/config.module.js';
import type { AppConfig } from '../config/config.service.js';
import {
  JIRA_CLIENT,
  LocalJiraClient,
  HttpJiraClient,
  type JiraClient,
} from './jira-client.service.js';
import { JiraValidationService } from './jira-validation.service.js';

/**
 * Jira read-only client + session-start validation (contract section 5).
 * Selects the client driver from config (JIRA_DRIVER). JiraValidationService is
 * request-scoped via its RequestContext dependency, so it is provided (not
 * factory-singleton) and exported for the capture/projects modules.
 *
 * Global so capture + projects inject JiraValidationService without re-importing.
 */
@Global()
@Module({
  providers: [
    {
      provide: JIRA_CLIENT,
      useFactory: (config: AppConfig): JiraClient =>
        config.JIRA_DRIVER === 'http' ? new HttpJiraClient(config) : new LocalJiraClient(),
      inject: [APP_CONFIG],
    },
    JiraValidationService,
  ],
  exports: [JIRA_CLIENT, JiraValidationService],
})
export class JiraModule {}
