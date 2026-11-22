import { Controller, Get, Header, Param, Query } from '@nestjs/common';
import { Public } from '../../common/guards/auth.guard.js';
import { PaginationQueryDto } from '../../common/dto/pagination.dto.js';
import { CatalogService } from './catalog.service.js';

@Public()
@Controller('public')
export class PublicCatalogController {
  constructor(private readonly catalogService: CatalogService) {}

  @Get('event-types')
  @Header('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300')
  listPublicEventTypes() {
    return this.catalogService.listEventTypes();
  }

  @Get('packages')
  @Header('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=120')
  listPublicPackages(@Query() query: PaginationQueryDto) {
    return this.catalogService.listPublicPackages(query);
  }

  @Get('portfolio')
  @Header('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=120')
  listPublicPortfolio(@Query() query: PaginationQueryDto) {
    return this.catalogService.listPublicPortfolio(query);
  }

  @Get('portfolio/events')
  @Header('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=120')
  listPublicPortfolioEvents(@Query() query: PaginationQueryDto) {
    return this.catalogService.listPublicPortfolioEvents(query);
  }

  @Get('portfolio/events/:slug')
  @Header('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=120')
  getPublicPortfolioEventBySlug(@Param('slug') slug: string) {
    return this.catalogService.getPublicPortfolioEventBySlug(slug);
  }

  @Get('gallery')
  @Header('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=120')
  listPublicGalleryMedia(@Query('resourceType') resourceType?: 'IMAGE' | 'VIDEO') {
    const validType =
      resourceType === 'IMAGE' || resourceType === 'VIDEO' ? resourceType : undefined;
    return this.catalogService.listPublicGalleryMedia(validType);
  }
}
