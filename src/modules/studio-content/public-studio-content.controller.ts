import { Controller, Get, Header } from '@nestjs/common';
import { Public } from '../../common/guards/auth.guard.js';
import { StudioContentService } from './studio-content.service.js';

@Public()
@Controller('public')
export class PublicStudioContentController {
  constructor(private readonly studioContentService: StudioContentService) {}

  @Get('services')
  @Header('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=120')
  listPublicServices() {
    return this.studioContentService.listPublicServices();
  }

  @Get('about-team')
  @Header('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=120')
  listPublicAboutTeam() {
    return this.studioContentService.listPublicAboutTeam();
  }
}
