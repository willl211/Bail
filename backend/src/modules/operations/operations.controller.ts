import { Body, Controller, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { IsIn, IsString, MaxLength, MinLength } from 'class-validator';
import { CurrentUser, Roles } from '../auth/session.guard';
import type { PublicUser } from '../auth/auth.service';
import { AuthProtectionGuard, AuthThrottle } from '../auth/auth-protection.guard';
import { OperationsService } from './operations.service';

class ErasureDto {
  @IsString() @MinLength(1) @MaxLength(128) password!: string;
}
class ReviewErasureDto {
  @IsIn(['HOLD', 'ERASE']) action!: 'HOLD' | 'ERASE';
  @IsString() @MinLength(3) @MaxLength(1000) note!: string;
}
@Controller('privacy')
@UseGuards(AuthProtectionGuard)
export class PrivacyController {
  constructor(private readonly ops: OperationsService) {}
  @Get('erasure') mine(@CurrentUser() user: PublicUser) {
    return this.ops.mine(user.id);
  }
  @Post('erasure')
  @AuthThrottle('credential')
  request(@CurrentUser() user: PublicUser, @Body() dto: ErasureDto) {
    return this.ops.requestErasure(user.id, dto.password);
  }
}
@Controller('admin/operations')
@Roles('AGENT')
@UseGuards(AuthProtectionGuard)
export class OperationsController {
  constructor(private readonly ops: OperationsService) {}
  @Get() dashboard() {
    return this.ops.dashboard();
  }
  @Post('erasure/:id')
  @AuthThrottle('credential')
  review(@Param('id') id: string, @CurrentUser() user: PublicUser, @Body() dto: ReviewErasureDto) {
    return this.ops.review(id, user.id, dto.action, dto.note);
  }
  @Post('incidents/:fingerprint/acknowledge')
  @HttpCode(204)
  acknowledge(@Param('fingerprint') fingerprint: string, @CurrentUser() user: PublicUser) {
    return this.ops.acknowledge(fingerprint, user.id);
  }
}
