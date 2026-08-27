import { IsBoolean, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateUomDto {
  @IsString()
  @IsNotEmpty()
  uomName!: string;

  @IsString()
  @IsNotEmpty()
  uomCode!: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  // FR-IA-11 rule 4: qty inputs reject decimals when the material's UoM is a
  // whole-unit measure (pcs, box, …). Defaults to true.
  @IsOptional()
  @IsBoolean()
  allowsDecimal?: boolean;
}
