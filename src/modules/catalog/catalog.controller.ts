import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { UserRole } from '../../generated/prisma/client.js';
import { Roles } from '../../common/guards/auth.guard.js';
import { PaginationQueryDto } from '../../common/dto/pagination.dto.js';
import { CatalogService } from './catalog.service.js';
import {
  CreateDeliverableLabelDto,
  CreateEventTypeDto,
  CreatePackageDto,
  CreatePortfolioEventDto,
  CreatePortfolioItemDto,
  CreateServiceItemDto,
  CreateTaskTemplateDto,
  ListPortfolioEventsQueryDto,
  RegisterPortfolioMediaDto,
  ReorderPortfolioMediaDto,
  SignPackageCoverUploadDto,
  SignPortfolioUploadDto,
  UpdateDeliverableLabelDto,
  UpdatePackageDto,
  UpdatePortfolioEventDto,
  UpdatePortfolioItemDto,
  UpdatePortfolioMediaDto,
  UpdateTaskTemplateDto,
} from './dto/catalog.dto.js';

@Controller('catalog')
export class CatalogController {
  constructor(private readonly catalogService: CatalogService) {}

  @Roles(UserRole.OWNER, UserRole.COORDINATOR)
  @Post('event-types')
  createEventType(@Body() dto: CreateEventTypeDto) {
    return this.catalogService.createEventType(dto);
  }

  @Get('event-types')
  listEventTypes() {
    return this.catalogService.listEventTypes();
  }

  @Roles(UserRole.OWNER, UserRole.COORDINATOR)
  @Post('services')
  createServiceItem(@Body() dto: CreateServiceItemDto) {
    return this.catalogService.createServiceItem(dto);
  }

  @Get('services')
  listServiceItems() {
    return this.catalogService.listServiceItems();
  }

  @Roles(UserRole.OWNER, UserRole.COORDINATOR)
  @Post('packages/sign-upload')
  signPackageCoverUpload(@Body() dto: SignPackageCoverUploadDto) {
    return this.catalogService.signPackageCoverUpload(dto);
  }

  @Roles(UserRole.OWNER, UserRole.COORDINATOR)
  @Post('packages')
  createPackage(@Body() dto: CreatePackageDto) {
    return this.catalogService.createPackage(dto);
  }

  @Roles(UserRole.OWNER, UserRole.COORDINATOR)
  @Patch('packages/:id')
  updatePackage(@Param('id') id: string, @Body() dto: UpdatePackageDto) {
    return this.catalogService.updatePackage(id, dto);
  }

  @Get('packages/:id')
  getPackage(@Param('id') id: string) {
    return this.catalogService.getPackageById(id);
  }

  @Get('packages')
  listPackages(@Query() query: PaginationQueryDto) {
    return this.catalogService.listPackages(query);
  }

  @Roles(UserRole.OWNER, UserRole.COORDINATOR)
  @Post('portfolio')
  createPortfolioItem(@Body() dto: CreatePortfolioItemDto) {
    return this.catalogService.createPortfolioItem(dto);
  }

  @Roles(UserRole.OWNER, UserRole.COORDINATOR)
  @Patch('portfolio/:id')
  updatePortfolioItem(@Param('id') id: string, @Body() dto: UpdatePortfolioItemDto) {
    return this.catalogService.updatePortfolioItem(id, dto);
  }

  @Roles(UserRole.OWNER, UserRole.COORDINATOR)
  @Post('deliverable-labels')
  createDeliverableLabel(@Body() dto: CreateDeliverableLabelDto) {
    return this.catalogService.createDeliverableLabel(dto);
  }

  @Roles(UserRole.OWNER, UserRole.COORDINATOR)
  @Patch('deliverable-labels/:id')
  updateDeliverableLabel(
    @Param('id') id: string,
    @Body() dto: UpdateDeliverableLabelDto,
  ) {
    return this.catalogService.updateDeliverableLabel(id, dto);
  }

  @Get('deliverable-labels')
  listDeliverableLabels() {
    return this.catalogService.listDeliverableLabels();
  }

  @Roles(UserRole.OWNER, UserRole.COORDINATOR)
  @Post('task-templates')
  createTaskTemplate(@Body() dto: CreateTaskTemplateDto) {
    return this.catalogService.createTaskTemplate(dto);
  }

  @Roles(UserRole.OWNER, UserRole.COORDINATOR)
  @Patch('task-templates/:id')
  updateTaskTemplate(@Param('id') id: string, @Body() dto: UpdateTaskTemplateDto) {
    return this.catalogService.updateTaskTemplate(id, dto);
  }

  @Get('task-templates')
  listTaskTemplates() {
    return this.catalogService.listTaskTemplates();
  }

  @Roles(UserRole.OWNER, UserRole.COORDINATOR)
  @Get('portfolio-events')
  listAdminPortfolioEvents(@Query() query: ListPortfolioEventsQueryDto) {
    return this.catalogService.listAdminPortfolioEvents(query);
  }

  @Roles(UserRole.OWNER, UserRole.COORDINATOR)
  @Get('portfolio-events/by-booking/:bookingId')
  getPortfolioEventByBooking(@Param('bookingId') bookingId: string) {
    return this.catalogService.getPortfolioEventByBooking(bookingId);
  }

  @Roles(UserRole.OWNER, UserRole.COORDINATOR)
  @Post('portfolio-events/from-booking/:bookingId')
  createPortfolioEventFromBooking(@Param('bookingId') bookingId: string) {
    return this.catalogService.createPortfolioEventFromBooking(bookingId);
  }

  @Roles(UserRole.OWNER, UserRole.COORDINATOR)
  @Get('portfolio-events/:id')
  getAdminPortfolioEvent(@Param('id') id: string) {
    return this.catalogService.getAdminPortfolioEvent(id);
  }

  @Roles(UserRole.OWNER, UserRole.COORDINATOR)
  @Post('portfolio-events')
  createPortfolioEvent(@Body() dto: CreatePortfolioEventDto) {
    return this.catalogService.createPortfolioEvent(dto);
  }

  @Roles(UserRole.OWNER, UserRole.COORDINATOR)
  @Patch('portfolio-events/:id')
  updatePortfolioEvent(
    @Param('id') id: string,
    @Body() dto: UpdatePortfolioEventDto,
  ) {
    return this.catalogService.updatePortfolioEvent(id, dto);
  }

  @Roles(UserRole.OWNER, UserRole.COORDINATOR)
  @Post('portfolio-events/:id/upload-signature')
  signPortfolioUpload(
    @Param('id') id: string,
    @Body() dto: SignPortfolioUploadDto,
  ) {
    return this.catalogService.signPortfolioUpload(id, dto);
  }

  @Roles(UserRole.OWNER, UserRole.COORDINATOR)
  @Post('portfolio-events/:id/media')
  registerPortfolioMedia(
    @Param('id') id: string,
    @Body() dto: RegisterPortfolioMediaDto,
  ) {
    return this.catalogService.registerPortfolioMedia(id, dto);
  }

  @Roles(UserRole.OWNER, UserRole.COORDINATOR)
  @Patch('portfolio-events/:id/media/:mediaId')
  updatePortfolioMedia(
    @Param('id') id: string,
    @Param('mediaId') mediaId: string,
    @Body() dto: UpdatePortfolioMediaDto,
  ) {
    return this.catalogService.updatePortfolioMedia(id, mediaId, dto);
  }

  @Roles(UserRole.OWNER, UserRole.COORDINATOR)
  @Put('portfolio-events/:id/media/reorder')
  reorderPortfolioMedia(
    @Param('id') id: string,
    @Body() dto: ReorderPortfolioMediaDto,
  ) {
    return this.catalogService.reorderPortfolioMedia(id, dto);
  }

  @Roles(UserRole.OWNER, UserRole.COORDINATOR)
  @Delete('portfolio-events/:id/media/:mediaId')
  removePortfolioMedia(
    @Param('id') id: string,
    @Param('mediaId') mediaId: string,
  ) {
    return this.catalogService.removePortfolioMedia(id, mediaId);
  }

  @Roles(UserRole.OWNER, UserRole.COORDINATOR)
  @Post('portfolio-events/:id/publish')
  publishPortfolioEvent(@Param('id') id: string) {
    return this.catalogService.publishPortfolioEvent(id);
  }

  @Roles(UserRole.OWNER, UserRole.COORDINATOR)
  @Post('portfolio-events/:id/unpublish')
  unpublishPortfolioEvent(@Param('id') id: string) {
    return this.catalogService.unpublishPortfolioEvent(id);
  }

  @Roles(UserRole.OWNER, UserRole.COORDINATOR)
  @Post('portfolio-events/:id/archive')
  archivePortfolioEvent(@Param('id') id: string) {
    return this.catalogService.archivePortfolioEvent(id);
  }

  @Roles(UserRole.OWNER, UserRole.COORDINATOR)
  @Get('gallery/status')
  getGalleryStatus() {
    return this.catalogService.getGalleryStatus();
  }

  @Roles(UserRole.OWNER, UserRole.COORDINATOR)
  @Get('gallery')
  listGalleryMedia(@Query('resourceType') resourceType?: 'IMAGE' | 'VIDEO') {
    const validType =
      resourceType === 'IMAGE' || resourceType === 'VIDEO' ? resourceType : undefined;
    return this.catalogService.listGalleryMedia(validType);
  }

  @Roles(UserRole.OWNER, UserRole.COORDINATOR)
  @Post('gallery/sign-upload')
  signGalleryUpload(@Body() dto: SignPortfolioUploadDto) {
    return this.catalogService.signGalleryUpload(dto);
  }

  @Roles(UserRole.OWNER, UserRole.COORDINATOR)
  @Post('gallery/register')
  registerGalleryMedia(@Body() dto: RegisterPortfolioMediaDto) {
    return this.catalogService.registerGalleryMedia(dto);
  }

  @Roles(UserRole.OWNER, UserRole.COORDINATOR)
  @Patch('gallery/:mediaId')
  updateGalleryMedia(
    @Param('mediaId') mediaId: string,
    @Body() dto: UpdatePortfolioMediaDto,
  ) {
    return this.catalogService.updateGalleryMedia(mediaId, dto);
  }

  @Roles(UserRole.OWNER, UserRole.COORDINATOR)
  @Delete('gallery/:mediaId')
  deleteGalleryMedia(@Param('mediaId') mediaId: string) {
    return this.catalogService.deleteGalleryMedia(mediaId);
  }
}
