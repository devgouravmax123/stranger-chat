import {
  IsNotEmpty,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class UpdatePublicKeyDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(100, { message: 'Public key is too short for P-256 SPKI format' })
  @MaxLength(300, { message: 'Public key exceeds maximum allowed length' })
  @Matches(/^[A-Za-z0-9+/=]+$/, {
    message: 'Public key must be a valid Base64 encoded string',
  })
  publicKey!: string;
}
