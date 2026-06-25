import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import {
  createProjectRequestSchema,
  updateProjectRequestSchema,
  setKnowledgeRequestSchema,
  setProjectTestFrameworkRequestSchema,
  setJiraConfigRequestSchema,
  type CreateProjectRequest,
  type UpdateProjectRequest,
  type SetKnowledgeRequest,
  type SetProjectTestFrameworkRequest,
  type SetJiraConfigRequest,
  type Project,
  type JiraConfig,
  type JiraTestResponse,
} from '@qassistant/shared';
import { Roles } from '../auth/decorators.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { ProjectsService } from './projects.service.js';

/**
 * Project setup endpoints (contract section 4.3). Reads are open to any tenant
 * user (extension + dashboard need to resolve projects); writes are admin-only.
 * Roles are declared per-handler so the read routes stay accessible to
 * qa-engineers while the mutating routes are gated to admins.
 */
@Controller('projects')
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Post()
  @Roles('admin')
  createProject(
    @Body(new ZodValidationPipe(createProjectRequestSchema)) body: CreateProjectRequest,
  ): Promise<Project> {
    return this.projects.createProject(body);
  }

  @Get()
  @Roles('admin', 'qa-engineer')
  listProjects(): Promise<Project[]> {
    return this.projects.listProjects();
  }

  @Get(':projectId')
  @Roles('admin', 'qa-engineer')
  getProject(@Param('projectId') projectId: string): Promise<Project> {
    return this.projects.getProject(projectId);
  }

  @Patch(':projectId')
  @Roles('admin')
  updateProject(
    @Param('projectId') projectId: string,
    @Body(new ZodValidationPipe(updateProjectRequestSchema)) body: UpdateProjectRequest,
  ): Promise<Project> {
    return this.projects.updateProject(projectId, body);
  }

  @Put(':projectId/knowledge')
  @Roles('admin')
  setKnowledge(
    @Param('projectId') projectId: string,
    @Body(new ZodValidationPipe(setKnowledgeRequestSchema)) body: SetKnowledgeRequest,
  ): Promise<Project> {
    return this.projects.setKnowledge(projectId, body);
  }

  // Per-project default test framework/language. Open to any tenant user (a team
  // preference, like the tenant fallback), unlike the admin-only project writes.
  @Put(':projectId/test-framework')
  @Roles('admin', 'qa-engineer')
  setTestFramework(
    @Param('projectId') projectId: string,
    @Body(new ZodValidationPipe(setProjectTestFrameworkRequestSchema))
    body: SetProjectTestFrameworkRequest,
  ): Promise<Project> {
    return this.projects.setTestFramework(projectId, body);
  }

  @Put(':projectId/jira')
  @Roles('admin')
  setJiraConfig(
    @Param('projectId') projectId: string,
    @Body(new ZodValidationPipe(setJiraConfigRequestSchema)) body: SetJiraConfigRequest,
  ): Promise<JiraConfig> {
    return this.projects.setJiraConfig(projectId, body);
  }

  @Delete(':projectId/jira')
  @Roles('admin')
  @HttpCode(204)
  async deleteJiraConfig(@Param('projectId') projectId: string): Promise<void> {
    await this.projects.deleteJiraConfig(projectId);
  }

  @Post(':projectId/jira/test')
  @Roles('admin')
  testJiraConfig(@Param('projectId') projectId: string): Promise<JiraTestResponse> {
    return this.projects.testJiraConfig(projectId);
  }
}
