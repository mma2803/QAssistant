import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { and, asc, eq } from 'drizzle-orm';
import type {
  CreateProjectRequest,
  UpdateProjectRequest,
  SetKnowledgeRequest,
  SetProjectTestFrameworkRequest,
  SetJiraConfigRequest,
  JiraTestResponse,
  Project,
  JiraConfig,
} from '@qassistant/shared';
import { DEFAULT_PROJECT_KNOWLEDGE_MD } from '@qassistant/shared';
import { RequestContext } from '../auth/request-context.js';
import { AppException } from '../auth/errors.js';
import { jiraConfigs, projects } from '../db/schema.js';
import { newId } from '../db/id.js';
import { toProject, toJiraConfig } from '../common/serializers.js';
import {
  SECRET_MANAGER,
  jiraTokenSecretId,
  type SecretManager,
} from '../secrets/secret-manager.service.js';
import { JiraValidationService } from '../jira/jira-validation.service.js';

/**
 * Project setup (contract section 4.3). Mutations are admin-only (enforced by the
 * controller role guard); reads (list/detail) are open to any tenant user so the
 * extension and dashboard can resolve projects. Every query runs in the
 * RLS-scoped request transaction with an explicit tenant_id predicate (D10).
 *
 * Jira tokens never touch the DB: the plaintext token is written to Secret
 * Manager and only the resource ref (token_secret_ref) is stored on the row
 * (contract 3.4; spec "Jira token manually replaced" = overwrite the secret).
 */
@Injectable()
export class ProjectsService {
  constructor(
    private readonly ctx: RequestContext,
    @Inject(SECRET_MANAGER) private readonly secrets: SecretManager,
    private readonly jiraValidation: JiraValidationService,
  ) {}

  private requireTenant(): string {
    const tenantId = this.ctx.tenantId;
    if (!tenantId) {
      throw new AppException('forbidden', 'Tenant scope required', HttpStatus.FORBIDDEN);
    }
    return tenantId;
  }

  /** POST /projects */
  async createProject(input: CreateProjectRequest): Promise<Project> {
    const tenantId = this.requireTenant();

    const existing = await this.ctx.dbTx
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.tenantId, tenantId), eq(projects.name, input.name)))
      .limit(1);
    if (existing.length > 0) {
      throw new AppException(
        'conflict',
        'A project with this name already exists',
        HttpStatus.CONFLICT,
      );
    }

    const [row] = await this.ctx.dbTx
      .insert(projects)
      .values({
        id: newId(),
        tenantId,
        name: input.name,
        baseUrl: input.baseUrl,
        status: 'active',
        // Seed the knowledge hub with the default guidance template so the
        // project's first generations are biased toward robust tests. Admins
        // can edit or clear it afterwards via setKnowledge.
        knowledgeMd: DEFAULT_PROJECT_KNOWLEDGE_MD,
        screenshotDefault: input.screenshotDefault,
        maskingSelectors: input.maskingSelectors,
        inactivityTimeoutSeconds: input.inactivityTimeoutSeconds,
      })
      .returning();
    return toProject(row!);
  }

  /** GET /projects: active projects in the tenant (extension + dashboard). */
  async listProjects(): Promise<Project[]> {
    const tenantId = this.requireTenant();
    const rows = await this.ctx.dbTx
      .select()
      .from(projects)
      .where(and(eq(projects.tenantId, tenantId), eq(projects.status, 'active')))
      .orderBy(asc(projects.name));
    return rows.map(toProject);
  }

  /** GET /projects/{id}: detail incl. knowledge-hub markdown (any status). */
  async getProject(projectId: string): Promise<Project> {
    return toProject(await this.loadProjectRow(projectId));
  }

  /** PATCH /projects/{id}: update settings and/or toggle active/inactive. */
  async updateProject(projectId: string, input: UpdateProjectRequest): Promise<Project> {
    const tenantId = this.requireTenant();
    await this.loadProjectRow(projectId);

    if (input.name !== undefined) {
      const clash = await this.ctx.dbTx
        .select({ id: projects.id })
        .from(projects)
        .where(and(eq(projects.tenantId, tenantId), eq(projects.name, input.name)))
        .limit(1);
      if (clash[0] && clash[0].id !== projectId) {
        throw new AppException(
          'conflict',
          'A project with this name already exists',
          HttpStatus.CONFLICT,
        );
      }
    }

    const [row] = await this.ctx.dbTx
      .update(projects)
      .set({
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.baseUrl !== undefined ? { baseUrl: input.baseUrl } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.screenshotDefault !== undefined
          ? { screenshotDefault: input.screenshotDefault }
          : {}),
        ...(input.maskingSelectors !== undefined
          ? { maskingSelectors: input.maskingSelectors }
          : {}),
        ...(input.inactivityTimeoutSeconds !== undefined
          ? { inactivityTimeoutSeconds: input.inactivityTimeoutSeconds }
          : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(projects.id, projectId), eq(projects.tenantId, tenantId)))
      .returning();
    return toProject(row!);
  }

  /** PUT /projects/{id}/knowledge: set knowledge_md + default_creds_secret_ref. */
  async setKnowledge(projectId: string, input: SetKnowledgeRequest): Promise<Project> {
    const tenantId = this.requireTenant();
    await this.loadProjectRow(projectId);
    const [row] = await this.ctx.dbTx
      .update(projects)
      .set({
        knowledgeMd: input.knowledgeMd,
        defaultCredsSecretRef: input.defaultCredsSecretRef,
        updatedAt: new Date(),
      })
      .where(and(eq(projects.id, projectId), eq(projects.tenantId, tenantId)))
      .returning();
    return toProject(row!);
  }

  /**
   * PUT /projects/{id}/test-framework: set the per-project default codegen target
   * (change: configurable-test-framework). Open to any tenant user. null = clear
   * the project value and inherit the tenant default for that field.
   */
  async setTestFramework(projectId: string, input: SetProjectTestFrameworkRequest): Promise<Project> {
    const tenantId = this.requireTenant();
    await this.loadProjectRow(projectId);
    const [row] = await this.ctx.dbTx
      .update(projects)
      .set({
        defaultTestFramework: input.defaultTestFramework,
        defaultTestLanguage: input.defaultTestLanguage,
        ...(input.defaultTestType !== undefined
          ? { defaultTestType: input.defaultTestType }
          : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(projects.id, projectId), eq(projects.tenantId, tenantId)))
      .returning();
    return toProject(row!);
  }

  /**
   * PUT /projects/{id}/jira: create or replace the project's Jira config. The
   * token goes to the encrypted secrets store (overwrite on replace = rotation, contract
   * 3.4); the row stores only the ref. At most one config per project.
   */
  async setJiraConfig(projectId: string, input: SetJiraConfigRequest): Promise<JiraConfig> {
    const tenantId = this.requireTenant();
    await this.loadProjectRow(projectId);

    const secretId = jiraTokenSecretId(projectId);
    const tokenSecretRef = await this.secrets.putSecret(secretId, input.token);

    const existing = await this.ctx.dbTx
      .select()
      .from(jiraConfigs)
      .where(and(eq(jiraConfigs.tenantId, tenantId), eq(jiraConfigs.projectId, projectId)))
      .limit(1);

    if (existing[0]) {
      const [row] = await this.ctx.dbTx
        .update(jiraConfigs)
        .set({
          baseUrl: input.baseUrl,
          projectKey: input.projectKey,
          tokenSecretRef,
          status: 'active',
          updatedAt: new Date(),
        })
        .where(and(eq(jiraConfigs.id, existing[0].id), eq(jiraConfigs.tenantId, tenantId)))
        .returning();
      return toJiraConfig(row!);
    }

    const [row] = await this.ctx.dbTx
      .insert(jiraConfigs)
      .values({
        id: newId(),
        tenantId,
        projectId,
        baseUrl: input.baseUrl,
        projectKey: input.projectKey,
        tokenSecretRef,
        status: 'active',
      })
      .returning();
    return toJiraConfig(row!);
  }

  /** DELETE /projects/{id}/jira: remove the config row and its secret. */
  async deleteJiraConfig(projectId: string): Promise<void> {
    const tenantId = this.requireTenant();
    await this.loadProjectRow(projectId);
    const deleted = await this.ctx.dbTx
      .delete(jiraConfigs)
      .where(and(eq(jiraConfigs.tenantId, tenantId), eq(jiraConfigs.projectId, projectId)))
      .returning({ id: jiraConfigs.id });
    if (deleted.length === 0) {
      throw new AppException('not_found', 'Jira configuration not found', HttpStatus.NOT_FOUND);
    }
    // Best-effort secret cleanup; row removal is the source of truth.
    await this.secrets.deleteSecret(jiraTokenSecretId(projectId));
  }

  /** POST /projects/{id}/jira/test: read-only connectivity check of the token. */
  async testJiraConfig(projectId: string): Promise<JiraTestResponse> {
    const tenantId = this.requireTenant();
    await this.loadProjectRow(projectId);
    const rows = await this.ctx.dbTx
      .select()
      .from(jiraConfigs)
      .where(and(eq(jiraConfigs.tenantId, tenantId), eq(jiraConfigs.projectId, projectId)))
      .limit(1);
    const config = rows[0];
    if (!config) {
      throw new AppException('not_found', 'Jira configuration not found', HttpStatus.NOT_FOUND);
    }
    return this.jiraValidation.testConnection(
      config.baseUrl,
      config.projectKey,
      config.tokenSecretRef,
    );
  }

  /** Load a project in the acting tenant or 404 (RLS + explicit predicate). */
  private async loadProjectRow(projectId: string): Promise<typeof projects.$inferSelect> {
    const tenantId = this.requireTenant();
    const rows = await this.ctx.dbTx
      .select()
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.tenantId, tenantId)))
      .limit(1);
    const row = rows[0];
    if (!row) {
      throw new AppException('not_found', 'Project not found', HttpStatus.NOT_FOUND);
    }
    return row;
  }
}
