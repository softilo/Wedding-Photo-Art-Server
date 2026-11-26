import { Controller, Get, Header } from '@nestjs/common';
import { Public } from '../../common/guards/auth.guard.js';
import { ReviewsService } from './reviews.service.js';

@Public()
@Controller('public')
export class PublicReviewsController {
  constructor(private readonly reviewsService: ReviewsService) {}

  @Get('reviews')
  @Header('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=120')
  listPublicReviews() {
    return this.reviewsService.listPublicReviews();
  }
}
