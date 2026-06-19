import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import {
  createUserRequestSchema,
  resetPasswordRequestSchema,
  updateUserRequestSchema,
  type CreateUserRequest,
  type ResetPasswordRequest,
  type TenantUser,
  type UpdateUserRequest,
} from '@qassistant/shared';
import { Roles } from '../auth/decorators.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { UsersService } from './users.service.js';

/**
 * Tenant user management (contract section 4.2). @Roles('admin') restricts every
 * route to tenant admins; a qa-engineer token is rejected by the AuthGuard with
 * `forbidden` (spec: "QA engineer cannot add users"). A tenant admin may create
 * or manage any user including another admin (spec: no restriction).
 */
@Controller('users')
@Roles('admin')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post()
  createUser(
    @Body(new ZodValidationPipe(createUserRequestSchema)) body: CreateUserRequest,
  ): Promise<TenantUser> {
    return this.usersService.createUser(body);
  }

  @Get()
  listUsers(): Promise<TenantUser[]> {
    return this.usersService.listUsers();
  }

  @Patch(':userId')
  updateUser(
    @Param('userId') userId: string,
    @Body(new ZodValidationPipe(updateUserRequestSchema)) body: UpdateUserRequest,
  ): Promise<TenantUser> {
    return this.usersService.updateUser(userId, body);
  }

  @Post(':userId/reset-password')
  resetPassword(
    @Param('userId') userId: string,
    @Body(new ZodValidationPipe(resetPasswordRequestSchema)) body: ResetPasswordRequest,
  ): Promise<TenantUser> {
    return this.usersService.resetPassword(userId, body);
  }
}
