import { Body, Controller, Get, Post, Put } from '@nestjs/common';
import { UserRole } from '../../generated/prisma/client.js';
import { Roles } from '../../common/guards/auth.guard.js';
import {
  SaveAboutTeamBulkDto,
  SaveStudioServicesBulkDto,
  SignStudioContentUploadDto,
} from './dto/studio-content.dto.js';
import { StudioContentService } from './studio-content.service.js';

@Controller('studio-content')
export class StudioContentController {
  constructor(private readonly studioContentService: StudioContentService) {}

  @Roles(UserRole.OWNER, UserRole.COORDINATOR)
  @Get('services')
  listAdminServices() {
    return this.studioContentService.listAdminServices();
  }

  @Roles(UserRole.OWNER, UserRole.COORDINATOR)
  @Post('services/sign-upload')
  signServiceUpload(@Body() dto: SignStudioContentUploadDto) {
    return this.studioContentService.signServiceUpload(dto);
  }

  @Roles(UserRole.OWNER, UserRole.COORDINATOR)
  @Put('services')
  saveServicesBulk(@Body() dto: SaveStudioServicesBulkDto) {
    return this.studioContentService.saveServicesBulk(dto);
  }

  @Roles(UserRole.OWNER, UserRole.COORDINATOR)
  @Post('services/reset-defaults')
  resetServicesDefaults() {
    return this.studioContentService.resetServicesDefaults();
  }

  @Roles(UserRole.OWNER, UserRole.COORDINATOR)
  @Get('about-team')
  listAdminAboutTeam() {
    return this.studioContentService.listAdminAboutTeam();
  }

  @Roles(UserRole.OWNER, UserRole.COORDINATOR)
  @Post('team/sign-upload')
  signTeamUpload(@Body() dto: SignStudioContentUploadDto) {
    return this.studioContentService.signTeamUpload(dto);
  }

  @Roles(UserRole.OWNER, UserRole.COORDINATOR)
  @Put('about-team')
  saveAboutTeamBulk(@Body() dto: SaveAboutTeamBulkDto) {
    return this.studioContentService.saveAboutTeamBulk(dto);
  }

  @Roles(UserRole.OWNER, UserRole.COORDINATOR)
  @Post('about-team/reset-defaults')
  resetAboutTeamDefaults() {
    return this.studioContentService.resetAboutTeamDefaults();
  }
}
