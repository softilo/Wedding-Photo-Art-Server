import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto.js';

export class CreateEventTypeDto {
  @IsString()
  name!: string;

  @IsOptional()
  @ValidateIf((_, val) => val !== null && val !== undefined && val !== '')
  @IsString()
  @Matches(/^[a-z0-9-]+$/)
  slug?: string;

  @IsOptional()
  @IsString()
  description?: string;
}

export class CreateServiceItemDto {
  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  unitLabel?: string;

  @IsInt()
  @Min(0)
  defaultUnitPricePoisha!: number;
}

export class PackageItemInputDto {
  @IsOptional()
  @IsUUID()
  serviceItemId?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(300)
  description!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantity!: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  unitPricePoisha!: number;
}

export class SignPackageCoverUploadDto {
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

export class CreatePackageDto {
  @IsOptional()
  @ValidateIf((_, val) => val !== null && val !== undefined)
  @IsUUID()
  eventTypeId?: string | null;

  @IsString()
  @MinLength(1)
  @MaxLength(160)
  name!: string;

  @IsOptional()
  @ValidateIf((_, val) => val !== null && val !== undefined && val !== '')
  @IsString()
  @Matches(/^[a-z0-9-]+$/, {
    message: 'slug must contain only lowercase letters, numbers, and hyphens',
  })
  slug?: string;

  @IsOptional()
  @ValidateIf((_, val) => val !== null && val !== undefined)
  @IsString()
  @MaxLength(1000)
  description?: string | null;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  basePricePoisha!: number;

  @IsOptional()
  @IsBoolean()
  isPublished?: boolean;

  @IsOptional()
  @ValidateIf((_, val) => val !== null && val !== undefined)
  @IsString()
  @MaxLength(1000)
  coverImageUrl?: string | null;

  @IsOptional()
  @ValidateIf((_, val) => val !== null && val !== undefined)
  @IsString()
  @MaxLength(160)
  coverImageAssetId?: string | null;

  @IsOptional()
  @ValidateIf((_, val) => val !== null && val !== undefined)
  @IsString()
  @MaxLength(260)
  coverImagePublicId?: string | null;

  @IsOptional()
  @ValidateIf((_, val) => val !== null && val !== undefined)
  @IsString()
  @MaxLength(16)
  coverImageFormat?: string | null;

  @IsOptional()
  @ValidateIf((_, val) => val !== null && val !== undefined)
  @Type(() => Number)
  @IsInt()
  @Min(0)
  coverImageBytes?: number | null;

  @IsOptional()
  @ValidateIf((_, val) => val !== null && val !== undefined)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  coverImageWidth?: number | null;

  @IsOptional()
  @ValidateIf((_, val) => val !== null && val !== undefined)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  coverImageHeight?: number | null;

  @IsOptional()
  @ValidateIf((_, val) => val !== null && val !== undefined)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  coverImageVersion?: number | null;

  @IsOptional()
  @ValidateIf((_, val) => val !== null && val !== undefined)
  @IsString()
  @MaxLength(128)
  coverImageResponseSignature?: string | null;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PackageItemInputDto)
  items?: PackageItemInputDto[];
}

export class UpdatePackageDto {
  @IsOptional()
  @ValidateIf((_, val) => val !== null && val !== undefined)
  @IsUUID()
  eventTypeId?: string | null;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  name?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9-]+$/, {
    message: 'slug must contain only lowercase letters, numbers, and hyphens',
  })
  slug?: string;

  @IsOptional()
  @ValidateIf((_, val) => val !== null && val !== undefined)
  @IsString()
  @MaxLength(1000)
  description?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  basePricePoisha?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsBoolean()
  isPublished?: boolean;

  @IsOptional()
  @ValidateIf((_, val) => val !== null && val !== undefined)
  @IsString()
  @MaxLength(1000)
  coverImageUrl?: string | null;

  @IsOptional()
  @ValidateIf((_, val) => val !== null && val !== undefined)
  @IsString()
  @MaxLength(160)
  coverImageAssetId?: string | null;

  @IsOptional()
  @ValidateIf((_, val) => val !== null && val !== undefined)
  @IsString()
  @MaxLength(260)
  coverImagePublicId?: string | null;

  @IsOptional()
  @ValidateIf((_, val) => val !== null && val !== undefined)
  @IsString()
  @MaxLength(16)
  coverImageFormat?: string | null;

  @IsOptional()
  @ValidateIf((_, val) => val !== null && val !== undefined)
  @Type(() => Number)
  @IsInt()
  @Min(0)
  coverImageBytes?: number | null;

  @IsOptional()
  @ValidateIf((_, val) => val !== null && val !== undefined)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  coverImageWidth?: number | null;

  @IsOptional()
  @ValidateIf((_, val) => val !== null && val !== undefined)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  coverImageHeight?: number | null;

  @IsOptional()
  @ValidateIf((_, val) => val !== null && val !== undefined)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  coverImageVersion?: number | null;

  @IsOptional()
  @ValidateIf((_, val) => val !== null && val !== undefined)
  @IsString()
  @MaxLength(128)
  coverImageResponseSignature?: string | null;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PackageItemInputDto)
  items?: PackageItemInputDto[];
}

export class CreatePortfolioItemDto {
  @IsOptional()
  @IsUUID()
  eventTypeId?: string;

  @IsString()
  title!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsString()
  mediaUrl!: string;

  @IsOptional()
  @IsBoolean()
  isApproved?: boolean;

  @IsOptional()
  @IsBoolean()
  isPublished?: boolean;

  @IsOptional()
  @IsInt()
  sortOrder?: number;
}

export class UpdatePortfolioItemDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsBoolean()
  isApproved?: boolean;

  @IsOptional()
  @IsBoolean()
  isPublished?: boolean;

  @IsOptional()
  @IsInt()
  sortOrder?: number;
}

export class CreateDeliverableLabelDto {
  @IsOptional()
  @IsUUID()
  eventTypeId?: string;

  @IsString()
  label!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  defaultDueDays?: number;
}

export class UpdateDeliverableLabelDto {
  @IsOptional()
  @IsString()
  label?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  defaultDueDays?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class CreateTaskTemplateDto {
  @IsOptional()
  @IsUUID()
  eventTypeId?: string;

  @IsString()
  title!: string;

  @IsString()
  roleLabel!: string;

  @IsOptional()
  @IsInt()
  defaultOffsetDays?: number;
}

export class UpdateTaskTemplateDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  roleLabel?: string;

  @IsOptional()
  @IsInt()
  defaultOffsetDays?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class CreatePortfolioEventDto {
  @IsString()
  title!: string;

  @IsOptional()
  @ValidateIf((_, val) => val !== null && val !== undefined && val !== '')
  @IsString()
  @Matches(/^[a-z0-9-]+$/, {
    message: 'slug must contain only lowercase letters, numbers, and hyphens',
  })
  slug?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'eventDate must be a valid YYYY-MM-DD date string',
  })
  eventDate?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  location?: string;

  @IsOptional()
  @IsUUID()
  eventTypeId?: string;
}

export class UpdatePortfolioEventDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9-]+$/, {
    message: 'slug must contain only lowercase letters, numbers, and hyphens',
  })
  slug?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'eventDate must be a valid YYYY-MM-DD date string',
  })
  eventDate?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  location?: string;

  @IsOptional()
  @IsUUID()
  eventTypeId?: string;

  @IsOptional()
  @IsUUID()
  coverMediaId?: string;

  @IsOptional()
  @IsInt()
  sortOrder?: number;
}

export class SignPortfolioUploadDto {
  @IsIn(['IMAGE', 'VIDEO'])
  resourceType!: 'IMAGE' | 'VIDEO';

  @IsString()
  format!: string;

  @IsInt()
  @Min(1)
  bytes!: number;
}

export class RegisterPortfolioMediaDto {
  @IsString()
  assetId!: string;

  @IsString()
  publicId!: string;

  @IsIn(['IMAGE', 'VIDEO'])
  resourceType!: 'IMAGE' | 'VIDEO';

  @IsString()
  format!: string;

  @IsString()
  secureUrl!: string;

  @IsInt()
  @Min(1)
  bytes!: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  width?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  height?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  durationSeconds?: number;

  @IsOptional()
  @IsString()
  caption?: string;

  @IsOptional()
  @IsString()
  altText?: string;

  @IsOptional()
  @IsIn(['PROCESSING', 'READY', 'FAILED'])
  status?: 'PROCESSING' | 'READY' | 'FAILED';

  @IsOptional()
  @IsString()
  errorMessage?: string;

  @IsOptional()
  @IsInt()
  version?: number;

  @IsOptional()
  @IsString()
  responseSignature?: string;
}

export class UpdatePortfolioMediaDto {
  @IsOptional()
  @IsString()
  caption?: string;

  @IsOptional()
  @IsString()
  altText?: string;

  @IsOptional()
  @IsIn(['PROCESSING', 'READY', 'FAILED'])
  status?: 'PROCESSING' | 'READY' | 'FAILED';

  @IsOptional()
  @IsString()
  errorMessage?: string;

  @IsOptional()
  @IsBoolean()
  isCover?: boolean;
}

export class ReorderPortfolioMediaDto {
  @IsArray()
  @IsUUID('4', { each: true })
  mediaIds!: string[];
}

export class ListPortfolioEventsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(['DRAFT', 'PUBLISHED', 'ARCHIVED'])
  status?: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';

  @IsOptional()
  @IsUUID()
  eventTypeId?: string;
}

