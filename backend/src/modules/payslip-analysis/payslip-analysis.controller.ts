import { Body, Controller, Get, Param, ParseIntPipe, Post, Query, Res } from '@nestjs/common';
import { IsInt, Max, Min } from 'class-validator';
import type { Response } from 'express';
import { CurrentUser, Roles } from '../auth/session.guard';
import type { PublicUser } from '../auth/auth.service';
import { PayslipAnalysisService } from './payslip-analysis.service';

class RequestAnalysisDto {
  @IsInt()
  @Min(1)
  @Max(2_147_483_647)
  expectedRevision!: number;
}

@Controller('admin/documents')
@Roles('AGENT')
export class PayslipAnalysisController {
  constructor(private readonly analyses: PayslipAnalysisService) {}

  @Get(':documentId/analysis')
  review(
    @Param('documentId') id: string,
    @Query('revision', ParseIntPipe) revision: number,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader('Cache-Control', 'private, no-store');
    return this.analyses.review(id, revision);
  }

  @Post(':documentId/analysis')
  request(
    @Param('documentId') id: string,
    @Body() dto: RequestAnalysisDto,
    @CurrentUser() actor: PublicUser,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader('Cache-Control', 'private, no-store');
    return this.analyses.requestAnalysis(id, dto.expectedRevision, actor.id);
  }
}
