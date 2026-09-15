import { IsArray, IsOptional, IsString, MaxLength, ArrayMaxSize, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class MessageItemDto {
  @IsString()
  @MaxLength(50)
  sender!: string;

  @IsString()
  @MaxLength(1000)
  text!: string;
}

export class ConversationSuggestionsDto {
  @IsArray()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => MessageItemDto)
  messages!: MessageItemDto[];

  @IsOptional()
  @IsString()
  @MaxLength(100)
  userId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  conversationId?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  previousSuggestions?: string[];
}
