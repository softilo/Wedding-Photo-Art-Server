import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class SignStudioContentUploadDto {
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

export class StudioServiceInputDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  id?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(600)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  imageUrl?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  imageAssetId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(260)
  imagePublicId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(16)
  imageFormat?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  imageBytes?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  imageWidth?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  imageHeight?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  imageVersion?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  imageResponseSignature?: string | null;

  @IsOptional()
  @IsBoolean()
  showOnHome?: boolean;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class SaveStudioServicesBulkDto {
  @IsBoolean()
  enabled!: boolean;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => StudioServiceInputDto)
  items!: StudioServiceInputDto[];
}

export class StudioAboutProfileInputDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  storyEyebrow!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(180)
  storyTitle!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(400)
  storyLead!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(1500)
  storyBody!: string;
}

export class StudioTeamMemberInputDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  id?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  subtitle?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  role?: string;

  @IsOptional()
  @IsString()
  @MaxLength(180)
  specialty?: string;

  @IsOptional()
  @IsString()
  @MaxLength(600)
  bio?: string;

  @IsOptional()
  @IsString()
  @MaxLength(320)
  quote?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  instagram?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  location?: string | null;

  @IsOptional()
  @IsBoolean()
  isFeatured?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  imageUrl?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  imageAssetId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(260)
  imagePublicId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(16)
  imageFormat?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  imageBytes?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  imageWidth?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  imageHeight?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  imageVersion?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  imageResponseSignature?: string | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class SaveAboutTeamBulkDto {
  @ValidateNested()
  @Type(() => StudioAboutProfileInputDto)
  profile!: StudioAboutProfileInputDto;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => StudioTeamMemberInputDto)
  members!: StudioTeamMemberInputDto[];
}
