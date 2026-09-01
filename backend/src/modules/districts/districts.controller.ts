import { Controller, Get } from '@nestjs/common';
import { DistrictsService } from './districts.service';

@Controller('districts')
export class DistrictsController {
  constructor(private readonly districts: DistrictsService) {}

  @Get()
  findAll() {
    return this.districts.findAllWithCounts();
  }
}
