import { HttpStatus, Injectable } from '@nestjs/common';
import { and, asc, eq } from 'drizzle-orm';
import type {
  CreateProjectRequest,
  UpdateProjectRequest,
  SetKnowledgeRequest,
  SetProjectTestFrameworkRequest,
  Project,
} from '@qassistant/shared';
import { DEFAULT_PROJECT_KNOWLEDGE_MD } from '@qassistant/shared';
import { RequestContext } from '../auth/request-context.js';
import { AppException } from '../auth/errors.js';
import { projects } from '../db/schema.js';
import { newId } from '../db/id.js';
import { toProject } from '../common/serializers.js';

/**
 * Project setup (contract section 4.3). Mutations are admin-only (enforced by the
 * controller role guard); reads (list/detail) are open to any tenant user so the
 * extension and dashboard can resolve projects. Every query runs in the
 * RLS-scoped request transaction with an explicit tenant_id predicate (D10).
 */
@Injectable()
export class ProjectsService {
  constructor(private readonly ctx: RequestContext) {}

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
