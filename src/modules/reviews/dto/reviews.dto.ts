import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class SignReviewUploadDto {
  @IsString()
  @MinLength(1)
  @MaxLength(16)
  format!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(25 * 1024 * 1024)
  bytes!: number;
}

export class ListReviewsQueryDto {
  @IsOptional()
  @IsIn(['all', 'published', 'draft'])
  status?: 'all' | 'published' | 'draft';
}

export class CreateClientReviewDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  clientName!: string;

  @IsString()
  @MinLength(3)
  @MaxLength(600)
  quote!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  rating?: number;

  @IsOptional()
  @IsString()
  @MaxLength(140)
  eventTitle?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  sourceLabel?: string;

  @IsString()
  @IsUrl({ protocols: ['https'], require_protocol: true })
  @MaxLength(1000)
  imageUrl!: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  imageAssetId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(260)
  imagePublicId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(16)
  imageFormat?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  imageBytes?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  imageWidth?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  imageHeight?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  imageVersion?: number;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  imageResponseSignature?: string;

  @IsOptional()
  @IsBoolean()
  isPublished?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10000)
  sortOrder?: number;
}

export class UpdateClientReviewDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  clientName?: string;

  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(600)
  quote?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  rating?: number;

  @IsOptional()
  @IsString()
  @MaxLength(140)
  eventTitle?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  sourceLabel?: string;

  @IsOptional()
  @IsString()
  @IsUrl({ protocols: ['https'], require_protocol: true })
  @MaxLength(1000)
  imageUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  imageAssetId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(260)
  imagePublicId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(16)
  imageFormat?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  imageBytes?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  imageWidth?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  imageHeight?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  imageVersion?: number;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  imageResponseSignature?: string;

  @IsOptional()
  @IsBoolean()
  isPublished?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10000)
  sortOrder?: number;
}

export class ReorderReviewsDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  reviewIds!: string[];
}
