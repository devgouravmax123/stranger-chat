import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
} from 'class-validator';

export class CreateProfileDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(3)
  username!: string;

  @IsInt()
  @Min(13)
  @Max(100)
  age!: number;

  @IsString()
  @IsNotEmpty()
  gender!: string;

  @IsOptional()
  @IsString()
  avatar?: string;
}