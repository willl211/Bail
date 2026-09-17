import { Body, Controller, HttpCode, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { AllowMfaPending, CurrentUser, RequestWithUser, Roles } from './session.guard';
import type { PublicUser } from './auth.service';
import { AuthProtectionGuard, AuthThrottle } from './auth-protection.guard';
import { MfaService } from './mfa.service';

class SetupMfaDto {
  @IsString() @MinLength(1) @MaxLength(128) password!: string;
}
class VerifyMfaDto {
  @IsString() @MinLength(6) @MaxLength(64) code!: string;
}
@Controller('auth/mfa')
@Roles('AGENT')
@AllowMfaPending()
@UseGuards(AuthProtectionGuard)
export class MfaController {
  constructor(
    private readonly mfa: MfaService,
    private readonly config: ConfigService,
  ) {}
  @Post('setup')
  @AuthThrottle('credential')
  setup(
    @CurrentUser() user: PublicUser,
    @Req() request: RequestWithUser,
    @Body() dto: SetupMfaDto,
  ) {
    return this.mfa.setup(user.id, dto.password, request.sessionToken!);
  }
  @Post('verify')
  @HttpCode(200)
  @AuthThrottle('mfa')
  async verify(
    @CurrentUser() user: PublicUser,
    @Req() request: RequestWithUser,
    @Body() dto: VerifyMfaDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.mfa.verify(user.id, request.sessionToken!, dto.code.trim());
    response.cookie(this.config.get<string>('auth.cookieName', 'bail_session'), result.token, {
      httpOnly: true,
      secure: this.config.get<boolean>('auth.cookieSecure', true),
      sameSite: 'lax',
      domain: this.config.get<string>('auth.cookieDomain'),
      path: '/',
      expires: result.expiresAt,
    });
    return { user: result.user, recoveryCodes: result.recoveryCodes };
  }
}
