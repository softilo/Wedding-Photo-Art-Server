import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { UserRole } from '../../generated/prisma/client.js';
import { Roles } from '../../common/guards/auth.guard.js';
import {
  CreateClientReviewDto,
  ListReviewsQueryDto,
  ReorderReviewsDto,
  SignReviewUploadDto,
  UpdateClientReviewDto,
} from './dto/reviews.dto.js';
import { ReviewsService } from './reviews.service.js';

@Controller('reviews')
export class ReviewsController {
  constructor(private readonly reviewsService: ReviewsService) {}

  @Roles(UserRole.OWNER, UserRole.COORDINATOR)
  @Get('upload-status')
  getUploadStatus() {
    return this.reviewsService.getUploadStatus();
  }

  @Roles(UserRole.OWNER, UserRole.COORDINATOR)
  @Post('sign-upload')
  signReviewUpload(@Body() dto: SignReviewUploadDto) {
    return this.reviewsService.signReviewUpload(dto);
  }

  @Roles(UserRole.OWNER, UserRole.COORDINATOR)
  @Get()
  listAdminReviews(@Query() query: ListReviewsQueryDto) {
    return this.reviewsService.listAdminReviews(query);
  }

  @Roles(UserRole.OWNER, UserRole.COORDINATOR)
  @Post()
  createReview(@Body() dto: CreateClientReviewDto) {
    return this.reviewsService.createReview(dto);
  }

  @Roles(UserRole.OWNER, UserRole.COORDINATOR)
  @Put('reorder')
  reorderReviews(@Body() dto: ReorderReviewsDto) {
    return this.reviewsService.reorderReviews(dto);
  }

  @Roles(UserRole.OWNER, UserRole.COORDINATOR)
  @Patch(':id')
  updateReview(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateClientReviewDto,
  ) {
    return this.reviewsService.updateReview(id, dto);
  }

  @Roles(UserRole.OWNER, UserRole.COORDINATOR)
  @Delete(':id')
  deleteReview(@Param('id', ParseUUIDPipe) id: string) {
    return this.reviewsService.deleteReview(id);
  }
}
