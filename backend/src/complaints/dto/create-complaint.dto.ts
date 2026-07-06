import {
  ArrayMaxSize,
  IsArray,
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';

export class CreateComplaintDto {
  @IsString()
  @IsNotEmpty()
  menuFeature!: string;

  @IsString()
  @IsNotEmpty()
  title!: string;

  @IsEmail()
  email!: string;

  @IsString()
  @IsNotEmpty()
  description!: string;

  // Up to 2 base64 image data URLs. Validated further in the service.
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(2)
  @IsString({ each: true })
  evidences?: string[];
}
