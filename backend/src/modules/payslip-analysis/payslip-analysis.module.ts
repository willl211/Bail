import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  PAYSLIP_DRIVER,
  DisabledPayslipDriver,
  OpenAIPayslipDriver,
  type PayslipDriver,
} from './payslip.driver';
import { PayslipAnalysisService } from './payslip-analysis.service';
import { PayslipAnalysisController } from './payslip-analysis.controller';

@Module({
  providers: [
    {
      provide: PAYSLIP_DRIVER,
      inject: [ConfigService],
      useFactory: (config: ConfigService): PayslipDriver => {
        const driver = config.get<string>('documentAnalysis.driver', 'disabled');
        if (driver === 'disabled') return new DisabledPayslipDriver();
        if (driver !== 'openai')
          throw new Error('DOCUMENT_ANALYSIS_DRIVER doit valoir disabled ou openai.');
        const key = config.get<string>('documentAnalysis.apiKey');
        const model = config.get<string>('documentAnalysis.model');
        if (!key || !model)
          throw new Error('L’analyse OpenAI nécessite OPENAI_API_KEY et DOCUMENT_ANALYSIS_MODEL.');
        return new OpenAIPayslipDriver(key, model);
      },
    },
    PayslipAnalysisService,
  ],
  controllers: [PayslipAnalysisController],
  exports: [PayslipAnalysisService],
})
export class PayslipAnalysisModule {}
