import { Module } from '@nestjs/common';
import { CaptureController } from './capture.controller.js';
import { CaptureService } from './capture.service.js';
import { InactivityService } from './inactivity.service.js';

/**
 * Extension capture module (contract section 4.4). Relies on global Db / Auth /
 * Jira / Storage modules. CaptureService injects JiraValidationService (session
 * start) and the GcsSigner (upload URLs); InactivityService runs the auto-close
 * backstop on the privileged pool.
 */
@Module({
  controllers: [CaptureController],
  providers: [CaptureService, InactivityService],
  exports: [CaptureService],
})
export class CaptureModule {}
