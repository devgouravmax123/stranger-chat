import {
  IsArray,
  IsNotEmpty,
  IsString,
} from 'class-validator';

export class UpdatePreferencesDto {
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