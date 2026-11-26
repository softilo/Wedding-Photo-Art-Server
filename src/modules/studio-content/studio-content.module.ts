import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module.js';
import { PublicStudioContentController } from './public-studio-content.controller.js';
import { StudioContentController } from './studio-content.controller.js';
import { StudioContentService } from './studio-content.service.js';

@Module({
  imports: [PrismaModule],
  controllers: [StudioContentController, PublicStudioContentController],
  providers: [StudioContentService],
  exports: [StudioContentService],
})
export class StudioContentModule {}
