import { IsIn, IsInt, IsNotEmpty, IsPositive, IsString, Max, Matches } from 'class-validator';

export class PresignedUploadDto {
  @IsString()
  @IsNotEmpty()
  chatId!: string;

  @IsString()
  @IsIn(['image', 'audio'])
  mediaType!: 'image' | 'audio';

  @IsString()
  @IsNotEmpty()
  @Matches(/^(image\/(jpeg|jpg|png|webp|gif)|audio\/(webm|mp4|ogg|wav|mpeg|aac|x-m4a|m4a|wave))(;.*)?$/, {
    message: 'mimeType must be an allowed image or audio format',
  })
  mimeType!: string;

  @IsInt()
  @IsPositive()
  @Max(5.5 * 1024 * 1024, {
    message: 'fileSize must not exceed 5.5 MB',
  })
  fileSize!: number;

  @IsString()
  @IsNotEmpty()
  @Matches(/^[A-Za-z0-9+/]{16}={0,2}$/, {
    message: 'iv must be a valid 12-byte Base64-encoded string',
  })
  iv!: string;
}
