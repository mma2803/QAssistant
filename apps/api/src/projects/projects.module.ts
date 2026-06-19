import { Module } from '@nestjs/common';
import { ProjectsController } from './projects.controller.js';
import { ProjectsService } from './projects.service.js';

/**
 * Project setup module (contract section 4.3). Relies on the global Db / Auth /
 * Secrets / Jira modules: SecretManager (Jira token storage) and
 * JiraValidationService (test endpoint) are injected from those globals.
 */
@Module({
  controllers: [ProjectsController],
  providers: [ProjectsService],
  exports: [ProjectsService],
})
export class ProjectsModule {}
