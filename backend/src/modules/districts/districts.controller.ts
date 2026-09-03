import { Controller, Get } from '@nestjs/common';
import { DistrictsService } from './districts.service';
import { Public } from '../auth/session.guard';

/** Référentiel public : la recherche est consultable sans compte. */
@Controller('districts')
@Public()
export class DistrictsController {
  constructor(private readonly districts: DistrictsService) {}

  @Get()
  findAll() {
    return this.districts.findAllWithCounts();
  }
}
