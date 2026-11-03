import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsString, IsUUID, MaxLength } from 'class-validator';

/** The most PNs one Quick Add paste can look up. */
export const RESOLVE_MAX_CODES = 500;

/** Quick Add: the pasted Part Numbers to look up in the sending warehouse. */
export class ResolveToItemsDto {
  @IsUUID()
  warehouse_id!: string;

  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(RESOLVE_MAX_CODES, { message: `At most ${RESOLVE_MAX_CODES} Part Numbers per paste` })
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  codes!: string[];
}
