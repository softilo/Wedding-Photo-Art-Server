import { Controller, Get, Header } from '@nestjs/common';
import { Public } from '../../common/guards/auth.guard.js';
import { StudioService } from './studio.service.js';

@Public()
@Controller('public')
export class PublicBrandingController {
  constructor(private readonly studioService: StudioService) {}

  @Get('branding')
  @Header('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=120')
  getBranding() {
    return this.studioService.getPublicBranding();
  }
}
