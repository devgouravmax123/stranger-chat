import {
  IsArray,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
} from 'class-validator';

export class CreateProfileDto {
  // ==========================================
  // USERNAME
  // ==========================================

  @IsString()
  @IsNotEmpty()
  @MinLength(3)
  username!: string;

  // ==========================================
  // AGE
  // ==========================================

  @IsInt()
  @Min(13)
  @Max(100)
  age!: number;

  // ==========================================
  // GENDER
  // ==========================================

  @IsString()
  @IsNotEmpty()
  gender!: string;

  // ==========================================
  // AVATAR
  // ==========================================

  @IsOptional()
  @IsString()
  avatar?: string;

  // ==========================================
  // LANGUAGE
  // ==========================================

  @IsString()
  @IsNotEmpty()
  language!: string;

  // ==========================================
  // INTERESTS
  // ==========================================

  @IsArray()
  @IsString({ each: true })
  interests!: string[];

  // ==========================================
  // LOOKING FOR
  // ==========================================

  @IsString()
  @IsNotEmpty()
  goal!: string;
}