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
  // INTERESTS
  // ==========================================

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  interests?: string[];

  // ==========================================
  // LANGUAGE
  // ==========================================

  @IsOptional()
  @IsString()
  language?: string;

  // ==========================================
  // GOAL
  // ==========================================

  @IsOptional()
  @IsString()
  goal?: string;
}